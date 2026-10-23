import { closeSync, existsSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { BuildError } from "../error.ts";
import { isBitcode } from "./binary-reader.ts";
import { namedBytesOfPe, readCoffGraph, sectionInFile } from "./coff-graph.ts";
import type { SectionGraph } from "./graph.ts";
import { createSectionOrder, findCompiledObjects, groupOfNode, writeTableIntoSection } from "./linker-common.ts";
import type { Link, Linker, LinkerFormat, SectionOrder } from "./linker.ts";
import type { Partition } from "./partition.ts";

const trimTableSection = ".buntrim";
const orderFlag = "/order:@";
const symbolMapFlag = "/map:";
const commonFlags = ["/lldsavetemps:prelink", "/opt:nolldtailmerge"];

const isMovable = (output: string) => output === ".text" || output === ".rdata";

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
    order.groups[group]!.names.push(...names);
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
  return {
    relinksSameInputs: linker.inputs.some(isBitcode),
    firstInputs: [],
    builtinModulesOutput: ".bunblt",
    isMovable,
    canBeFilled: output => isMovable(output) || output === ".data",
    isCode: output => output === ".text",
    supportObjects: room => [
      linker.assemble("room.s", `.section ${trimTableSection},"dr"\n.p2align 3\n.zero ${room}\n`),
    ],
    prepareInput: path => path,
    prepareCompiledObjects: () => false,
    compiledObjects,
    firstLinkArguments: () => ({
      last: [...commonFlags],
      replaced: new Map([[symbolMapAt, symbolMapFlag + firstSymbolMap]]),
      without: /^\/(debug|pdb)(:|$)/i,
    }),
    secondLinkArguments(order) {
      writeFileSync(orderFile, order.groups.flatMap(group => group.names).join("\n") + "\n" + commandOrder, "latin1");
      if (orderAt >= 0) return { last: [...commonFlags], replaced: new Map([[orderAt, orderFlag + orderFile]]) };
      return { last: [...commonFlags, orderFlag + orderFile, "/ignore:4037"], replaced: new Map() };
    },
    read: link =>
      readCoffGraph({
        executable: link.executable,
        chunkMap: link.map,
        symbolMap: symbolMapOf(link),
        inputs: [...linker.inputs, ...compiledObjects("first"), ...compiledObjects("second")],
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
