import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { BuildError } from "../error.ts";
import { readArchiveIndex } from "./archive.ts";
import { readAt } from "./binary-reader.ts";
import { findLinkedMembers, namedBytesOfPe, readCoffGraph, sectionInFile } from "./coff-graph.ts";
import { nameSections } from "./coff-object-editor.ts";
import { builtinModulesSection, CoffObject } from "./coff-objects.ts";
import type { SectionGraph } from "./graph.ts";
import { createSectionOrder, findCompiledObjects, groupOfNode, writeTableIntoSection } from "./linker-common.ts";
import type { Link, Linker, LinkerFormat, SectionOrder } from "./linker.ts";
import type { Partition } from "./partition.ts";

const trimTableSection = ".buntrim";
const orderFlag = "/order:@";
const symbolMapFlag = "/map:";
const commonFlags = ["/lldsavetemps:prelink", "/opt:nolldtailmerge"];
export const unnamedSectionPrefix = "bun_unnamed_";

const IMAGE_SYM_CLASS_EXTERNAL = 2;
const bitcodeMagic = 0x4243c0de;

/**
 * A name that `objects`, compiled from bitcode, refer to and none of them defines, and that the index of an archive offers from a
 * member of bitcode. lld-link resolves a weak alias of a bitcode file (`??_E..`, the vector deleting destructor, for `??_G..`) from what
 * it read when it parsed the file: no copy prevails for LTO, and what is compiled only refers to the name. So does it where the copy
 * of a COMDAT that prevailed came from a native member of a later archive. A link of the objects in front of the archives finds such a
 * name undefined, takes the member of bitcode for it, and that collides with the object compiled from it.
 */
function findNameThatLoadsBitcode(objects: readonly string[], inputs: readonly string[]): string | undefined {
  const defined = new Set<string>();
  const wanted = new Set<string>();
  for (const path of objects) {
    const fd = openSync(path, "r");
    try {
      const object = CoffObject.open(fd, 0, statSync(path).size);
      object?.symbolClass.forEach((storage, symbol) => {
        if (storage === 0) return;
        const isWanted =
          storage === IMAGE_SYM_CLASS_EXTERNAL &&
          object.symbolSection[symbol] === 0 &&
          object.symbolValue[symbol] === 0;
        (isWanted ? wanted : defined).add(object.nameOf(symbol));
      });
    } finally {
      closeSync(fd);
    }
  }
  for (const archive of inputs) {
    if (!/\.(lib|rlib|a)$/i.test(archive) || !existsSync(archive)) continue;
    const fd = openSync(archive, "r");
    try {
      const isBitcodeAt = new Map<number, boolean>();
      for (const [name, header] of readArchiveIndex(archive)) {
        if (!wanted.has(name) || defined.has(name)) continue;
        let isBitcode = isBitcodeAt.get(header);
        if (isBitcode === undefined) {
          isBitcode = readAt(fd, header + 60, 4).readUInt32BE(0) === bitcodeMagic;
          isBitcodeAt.set(header, isBitcode);
        }
        if (isBitcode) return name;
      }
    } finally {
      closeSync(fd);
    }
  }
  return undefined;
}

const isMovable = (output: string) => output === ".text" || output === ".rdata" || output === builtinModulesSection;

function orderOf(graph: SectionGraph, partition: Partition): SectionOrder {
  const groupOf = (node: number) => groupOfNode(graph, partition, isMovable, node);
  const groupOfName = new Map<string, number>();
  graph.names.forEach((names, node) => {
    const group = groupOf(node);
    for (const name of names) groupOfName.set(name, (groupOfName.get(name) ?? group) === group ? group : -1);
  });
  const order = createSectionOrder(partition);
  graph.names.forEach((all, node) => {
    const group = groupOf(node);
    const names = all.filter(name => groupOfName.get(name) === group);
    if (group < 0 || names.length === 0) return;
    // One unwind record may serve a hundred thousand functions, and has a name for each.
    for (const name of names) order.groups[group]!.names.push(name);
    order.nodes.push(node);
  });
  return order;
}

export function coff(linker: Linker): LinkerFormat {
  const { work, output, command } = linker;
  const getFlagValues = (flag: string) =>
    command.filter(argument => argument.toLowerCase().startsWith(flag)).map(argument => argument.slice(flag.length));
  const findFlag = (flag: string) => command.findIndex(argument => argument.toLowerCase().startsWith(flag));
  const [orderAt, symbolMapAt] = [findFlag(orderFlag), findFlag(symbolMapFlag)];
  if (symbolMapAt < 0) throw new BuildError("the link command names no /map");
  const finalSymbolMap = command[symbolMapAt]!.slice(symbolMapFlag.length);
  const firstSymbolMap = join(work, "first.symbols.map");
  const commandOrder = orderAt >= 0 ? readFileSync(command[orderAt]!.slice(orderFlag.length), "latin1") : "";
  const orderFile = join(work, "order.txt");
  const machine = getFlagValues("/machine:")[0];
  if (machine === undefined) throw new BuildError("the link command names no /machine");
  const architecture = machine.toLowerCase();
  const alternateNames = getFlagValues("/alternatename:").map(definition => definition.split("=")[0]!);
  const listFolder = (folder: string) =>
    existsSync(folder)
      ? readdirSync(folder)
          .sort()
          .map(name => join(folder, name))
      : [];
  const libraryFolders = [
    ...getFlagValues("/libpath:"),
    ...getFlagValues("/winsysroot:").flatMap(root => [
      ...listFolder(join(root, "VC", "Tools", "MSVC")).map(version => join(version, "lib", architecture)),
      ...listFolder(join(root, "Windows Kits", "10", "Lib")).flatMap(version => [
        join(version, "ucrt", architecture),
        join(version, "um", architecture),
      ]),
    ]),
  ];
  const inputDirectories = new Set([work, ...linker.inputs.map(path => dirname(path))]);
  const executableNames = { first: linker.firstLinkName + ".exe", second: basename(output) };
  const compiledObjects = (link: "first" | "second") => findCompiledObjects(inputDirectories, executableNames[link]);
  const tidyUp = () => {
    for (const object of [...compiledObjects("first"), ...compiledObjects("second")]) rmSync(object);
  };
  tidyUp();
  const symbolMapOf = (link: Link) => (link.name === "first" ? firstSymbolMap : finalSymbolMap);
  const namedFolder = join(work, "named");
  const namedCopies = new Map<string, string>();
  let named: string[] = [];
  let relinksSameInputs = false;
  let ordinal = 0;
  const nextPrefix = () => unnamedSectionPrefix + ordinal++;
  // A member that the first link took is linked as a file of its own, in front of its archive: what it defines is defined by then, so
  // the archive's copy is not taken again. The same holds for what the first link compiled from a member that is bitcode.
  const nameLinkedMembers = (first: Link) =>
    findLinkedMembers(first.map, linker.inputs).flatMap(([name, { archive, offset, size }], index) => {
      const copy = join(namedFolder, "members", String(index), basename(name.replaceAll("\\", "/")));
      const fd = openSync(archive, "r");
      mkdirSync(dirname(copy), { recursive: true });
      writeFileSync(copy, readAt(fd, offset, size));
      closeSync(fd);
      if (nameSections(copy, nextPrefix())) return [copy];
      rmSync(copy);
      return [];
    });
  return {
    firstInputs: [],
    builtinModulesOutput: builtinModulesSection,
    isMovable,
    canBeFilled: output => isMovable(output) || output === ".data",
    isCode: output => output === ".text",
    supportObjects: room => [
      linker.assemble("room.s", `.section ${trimTableSection},"dr"\n.p2align 3\n.zero ${room}\n`),
    ],
    prepareInput(path) {
      if (!existsSync(path)) return path;
      let copy = namedCopies.get(path);
      if (copy === undefined) {
        copy = join(namedFolder, "objects", resolve(path).replace(/^([a-z]:)?[\\/]+/i, ""));
        if (!nameSections(path, nextPrefix(), copy)) copy = path;
        namedCopies.set(path, copy);
      }
      return copy;
    },
    prepareCompiledObjects(objects, first) {
      const name = findNameThatLoadsBitcode(objects, linker.inputs);
      if (name !== undefined) {
        console.log(
          `trim: the second link compiles the bitcode again: linked in front of the archives, what the first link compiled would take a member of bitcode for ${name}`,
        );
        relinksSameInputs = true;
        named = objects;
        return undefined;
      }
      for (const object of objects) nameSections(object, nextPrefix());
      named = [...objects, ...nameLinkedMembers(first)];
      return named.length > 0 ? named : undefined;
    },
    relinksSameInputs: () => relinksSameInputs,
    compiledObjects(link) {
      const objects = compiledObjects(link);
      const empty = objects.filter(object => statSync(object).size === 0);
      if (empty.length > 0) {
        throw new BuildError(
          `the linker left ${empty.length} empty files for objects compiled from bitcode: it does so when it has a ThinLTO cache; link without one`,
        );
      }
      return objects;
    },
    firstLinkArguments: () => ({
      last: [...commonFlags],
      replaced: new Map([[symbolMapAt, symbolMapFlag + firstSymbolMap]]),
      without: /^\/(debug|pdb)(:|$)/i,
    }),
    secondLinkArguments(order) {
      // What the command's file lists stays where it lay, behind the features. Of that, what belongs to a feature comes first, so
      // it can be cut with the rest of the features. lld-link places a name by the last line that has it: each name gets one line.
      const names = order.groups.flatMap(group => group.names);
      const grouped = new Set(names);
      const commandNames = commandOrder.split(/\r?\n/).filter(name => name !== "");
      const listed = new Set(commandNames);
      const lines = [
        ...names.filter(name => !listed.has(name)),
        ...names.filter(name => listed.has(name)),
        ...commandNames.filter(name => !grouped.has(name)),
      ];
      writeFileSync(orderFile, lines.join("\n") + "\n", "latin1");
      if (orderAt >= 0) return { last: [...commonFlags], replaced: new Map([[orderAt, orderFlag + orderFile]]) };
      return { last: [...commonFlags, orderFlag + orderFile, "/ignore:4037"], replaced: new Map() };
    },
    read: link =>
      readCoffGraph({
        executable: link.executable,
        chunkMap: link.map,
        symbolMap: symbolMapOf(link),
        inputs: [...linker.inputs, ...namedCopies.values(), ...named, ...compiledObjects("second")],
        libraryFolders,
        alternateNames,
      }),
    namedBytes: link => namedBytesOfPe(link.executable, symbolMapOf(link)),
    orderOf,
    nameUnnamedSections: () => new Map(),
    writeTable(table) {
      const path = resolve(output);
      const room = sectionInFile(path, trimTableSection);
      const fd = openSync(path, "r+");
      try {
        writeTableIntoSection(fd, table, output, trimTableSection, room);
      } finally {
        closeSync(fd);
      }
    },
    tidyUp,
  };
}
