import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { BuildError } from "../error.ts";
import { isElfObject } from "./binary-reader.ts";
import { openElf } from "./elf-file.ts";
import { readElfGraph } from "./elf-graph.ts";
import { nameSections, splitMergeableSections } from "./elf-object-editor.ts";
import { isCode, isMovable } from "./elf-objects.ts";
import type { SectionGraph } from "./graph.ts";
import { namedBytesOfElf } from "./icu-data.ts";
import { createSectionOrder, findCompiledObjects, groupOfNode, writeTableIntoSection } from "./linker-common.ts";
import type { Linker, LinkerFormat, SectionOrder } from "./linker.ts";
import type { Partition } from "./partition.ts";

export const unnamedSectionPrefix = "bun_unnamed_";

const debuggerOnlyFlags = /^-Wl,--(gdb-index|compress-debug-sections=.*)$/;
const orderFlag = "-Wl,--symbol-ordering-file=";
const trimTableSection = ".bun_trim";
const commonFlags = ["-Wl,--print-icf-sections", "-Wl,--save-temps=prelink"];

const roomSource = (room: number) => `.section ${trimTableSection},"aR",@progbits\n.p2align 3\n.zero ${room}\n`;

const copyPath = (folder: string, path: string) => join(folder, isAbsolute(path) ? path.slice(1) : path);

function orderOf(graph: SectionGraph, partition: Partition): SectionOrder {
  const groupOf = (node: number) => groupOfNode(graph, partition, isMovable, node);
  const namesOf = (node: number) => [...graph.names[node]!, ...(graph.aliases.get(node) ?? []).map(([, name]) => name)];
  const groupOfName = new Map<string, number>();
  for (let node = 0; node < graph.count; node++) {
    if (!isMovable(graph.output[node]!)) continue;
    const group = groupOf(node);
    for (const name of namesOf(node)) {
      const before = groupOfName.get(name);
      groupOfName.set(name, before === undefined || before === group ? group : -1);
    }
  }
  const order = createSectionOrder(partition);
  for (let node = 0; node < graph.count; node++) {
    const group = groupOf(node);
    if (group < 0 || graph.object[node] === "<internal>") continue;
    const names = namesOf(node).filter(name => groupOfName.get(name) === group);
    order.groups[group]!.names.push(...names);
    order.nodes.push(node);
    if (names.length > 0) continue;
    const sections = order.unnamed.get(graph.object[node]!);
    if (sections === undefined) order.unnamed.set(graph.object[node]!, new Map([[graph.section[node]!, group]]));
    else sections.set(graph.section[node]!, group);
  }
  return order;
}

export function elf(linker: Linker): LinkerFormat {
  const { work, output, command } = linker;
  const orderAt = command.findIndex(argument => argument.startsWith(orderFlag));
  const commandOrder = orderAt >= 0 ? readFileSync(command[orderAt]!.slice(orderFlag.length), "latin1") : "";
  const orderFile = join(work, "order.txt");
  const inputDirectories = new Set([work, ...linker.inputs.map(path => dirname(path))]);
  const executableNames = { first: linker.firstLinkName, second: basename(output) };
  const listCompiledObjects = (link: "first" | "second") =>
    findCompiledObjects(inputDirectories, executableNames[link]);
  const tidyUp = () => {
    for (const object of [...listCompiledObjects("first"), ...listCompiledObjects("second")]) rmSync(object);
  };
  tidyUp();
  const splitCopies = new Map<string, string>();
  let splitOrdinal = 0;
  const splitInPlace = (path: string) => splitMergeableSections(path, `${unnamedSectionPrefix}piece${splitOrdinal++}`);
  return {
    relinksSameInputs: false,
    firstInputs: [],
    builtinModulesOutput: ".bun_builtins",
    isMovable,
    canBeFilled: output => isMovable(output) || output === ".data" || output === ".data.rel.ro",
    isCode,
    supportObjects: room => [linker.assemble("room.s", roomSource(room))],
    prepareInput(path) {
      if (!isElfObject(path)) return path;
      let copy = splitCopies.get(path);
      if (copy === undefined) {
        copy = copyPath(join(work, "split"), path);
        mkdirSync(dirname(copy), { recursive: true });
        copyFileSync(path, copy, constants.COPYFILE_FICLONE);
        splitInPlace(copy);
        splitCopies.set(path, copy);
      }
      return copy;
    },
    prepareCompiledObjects(objects) {
      for (const object of objects) splitInPlace(object);
      return objects.length > 0;
    },
    compiledObjects(link) {
      const objects = listCompiledObjects(link);
      const empty = objects.filter(object => statSync(object).size === 0);
      if (empty.length > 0) {
        throw new BuildError(
          `the linker left ${empty.length} empty files for objects compiled from bitcode: it does so when it has a ThinLTO cache; link without one`,
        );
      }
      return objects;
    },
    firstLinkArguments: () => ({
      last: [...commonFlags, "-Wl,--strip-debug"],
      replaced: new Map(),
      without: debuggerOnlyFlags,
    }),
    secondLinkArguments(order) {
      writeFileSync(orderFile, order.groups.flatMap(group => group.names).join("\n") + "\n" + commandOrder, "latin1");
      if (orderAt >= 0) return { last: [...commonFlags], replaced: new Map([[orderAt, orderFlag + orderFile]]) };
      return { last: [...commonFlags, orderFlag + orderFile, "-Wl,--no-warn-symbol-ordering"], replaced: new Map() };
    },
    read: link => readElfGraph(link.executable, link.map, link.log),
    namedBytes: link => namedBytesOfElf(link.executable),
    orderOf,
    nameUnnamedSections(order, writable) {
      const editedInPlace = new Set([...writable, ...splitCopies.values()]);
      const copies = new Map<string, string>();
      let ordinal = 0;
      for (const [object, sections] of order.unnamed) {
        if (!existsSync(object)) continue;
        let path = object;
        if (!editedInPlace.has(object)) {
          path = copyPath(join(work, "named"), object);
          mkdirSync(dirname(path), { recursive: true });
          copyFileSync(object, path);
          copies.set(object, path);
        }
        for (const [section, name] of nameSections(path, new Set(sections.keys()), unnamedSectionPrefix + ordinal++)) {
          order.groups[sections.get(section)!]!.names.push(name);
        }
      }
      return copies;
    },
    writeTable(table) {
      const file = openElf(resolve(output), "r+");
      if (file === undefined) throw new BuildError(`${output} is not an ELF file`);
      try {
        const room = file.sections.find(section => section.name === trimTableSection);
        writeTableIntoSection(file.fd, table, output, trimTableSection, room);
      } finally {
        closeSync(file.fd);
      }
    },
    tidyUp,
  };
}
