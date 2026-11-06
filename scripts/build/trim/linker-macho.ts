import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { BuildError } from "../error.ts";
import { fixedName, readAt } from "./binary-reader.ts";
import type { SectionGraph } from "./graph.ts";
import { createSectionOrder, groupOfNode, writeTableIntoSection, type FileRange } from "./linker-common.ts";
import type { LinkArguments, Linker, LinkerFormat, SectionOrder } from "./linker.ts";
import { isOneUnitOfAssembly, readMachOGraph } from "./macho-graph.ts";
import { LC_SEGMENT_64, MH_MAGIC_64 } from "./macho-objects.ts";
import type { Partition } from "./partition.ts";

const trimTableSection = "__bun_trim";
const orderFlag = "-Wl,-order_file,";
const compiledFolderFlag = "-Wl,-object_path_lto,";
const headerPadFlag = "-Wl,-headerpad,0x2000";
const exportedSymbolsFlag = "-exported_symbols_list";

const roomSource = (room: number) =>
  `.section __TEXT,${trimTableSection}\n.p2align 3\n.globl _Bun__trimTable\n.no_dead_strip _Bun__trimTable\n_Bun__trimTable:\n.zero ${room}\n` +
  `.literal8\n.quad 0\n.cstring\n.asciz "placed before the built-in modules and the constants"\n` +
  `.subsections_via_symbols\n`;

const isMovable = (output: string) =>
  ["__TEXT,__text", "__TEXT,__const", "__TEXT,__bun_builtins", "__TEXT,__cstring", "__DATA_CONST,__const"].includes(
    output,
  ) || isOneUnitOfAssembly(output);

function findMachOSection(fd: number, name: string): FileRange | undefined {
  if (fstatSync(fd).size < 32) return undefined;
  const header = readAt(fd, 0, 32);
  if (header.readUInt32LE(0) !== MH_MAGIC_64) return undefined;
  const commands = readAt(fd, 32, header.readUInt32LE(20));
  for (let at = 0; at < commands.length; at += commands.readUInt32LE(at + 4)) {
    if (commands.readUInt32LE(at) !== LC_SEGMENT_64) continue;
    for (let index = 0; index < commands.readUInt32LE(at + 64); index++) {
      const section = at + 72 + index * 80;
      if (fixedName(commands, section) === name)
        return { offset: commands.readUInt32LE(section + 48), size: Number(commands.readBigUInt64LE(section + 40)) };
    }
  }
  return undefined;
}

function hasMachOSection(path: string, name: string): boolean {
  if (!existsSync(path) || !statSync(path).isFile()) return false;
  const fd = openSync(path, "r");
  try {
    return findMachOSection(fd, name) !== undefined;
  } finally {
    closeSync(fd);
  }
}

function orderOf(graph: SectionGraph, partition: Partition): SectionOrder {
  const groupOf = (node: number) => groupOfNode(graph, partition, isMovable, node);
  const isMoved = (node: number) => groupOf(node) >= 0;
  const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const stem = (name: string) => name.split(".llvm.")[0]!.split(".__uniq.")[0]!;
  const spell = (object: string, name: string) => (graph.externalNames.has(name) ? name : `${base(object)}:${name}`);
  const namesOf = (node: number): [string, string][] => [
    [graph.object[node]!, graph.section[node]!],
    ...(graph.aliases.get(node) ?? []),
  ];
  const namesOfUnmovedNodes = new Set<string>();
  const stemsOfUnmovedNodes = new Set<string>();
  for (let node = 0; node < graph.count; node++) {
    if (isMoved(node)) continue;
    for (const [object, name] of namesOf(node)) {
      namesOfUnmovedNodes.add(base(graph.object[node]!) + "\0" + stem(name));
      namesOfUnmovedNodes.add(base(object) + "\0" + stem(name));
      stemsOfUnmovedNodes.add(stem(name));
      if (graph.externalNames.has(name)) namesOfUnmovedNodes.add("\0" + stem(name));
    }
  }
  const namesOnlyMovedNodes = (node: number, object: string, name: string) =>
    graph.externalNames.has(name)
      ? !stemsOfUnmovedNodes.has(stem(name))
      : !namesOfUnmovedNodes.has(base(graph.object[node]!) + "\0" + stem(name)) &&
        !namesOfUnmovedNodes.has(base(object) + "\0" + stem(name)) &&
        !namesOfUnmovedNodes.has("\0" + stem(name));
  const retainedStringHashes = new Set<number>();
  for (const [node, hash] of graph.stringHash) if (!isMoved(node)) retainedStringHashes.add(hash);
  const order = createSectionOrder(partition);
  for (const hash of retainedStringHashes) order.retainedFirst.push("CSTR;" + hash);
  const laysRetainedFirst = (output: string) => output === "__DATA_CONST,__const";
  for (let node = 0; node < graph.count; node++) {
    if (laysRetainedFirst(graph.output[node]!) && !isMoved(node))
      order.retainedFirst.push(spell(graph.object[node]!, graph.section[node]!));
  }
  const lineOf = (node: number, name: string) =>
    graph.externalNames.has(name) ? stem(name) : `${base(graph.object[node]!)}:${stem(name)}`;
  const lastGroupOfLine = new Map<string, number>();
  const linesAfterRetained = new Set<string>();
  const written = new Set<string>();
  const isNamed = (node: number) =>
    graph.stringHash.get(node) === undefined && !isOneUnitOfAssembly(graph.output[node]!);
  for (let node = 0; node < graph.count; node++) {
    const group = groupOf(node);
    if (group < 0 || !isNamed(node)) continue;
    for (const [object, name] of namesOf(node)) {
      for (const line of [lineOf(node, name), `${base(object)}:${stem(name)}`, stem(name)]) {
        lastGroupOfLine.set(line, Math.max(lastGroupOfLine.get(line) ?? 0, group));
        if (laysRetainedFirst(graph.output[node]!)) linesAfterRetained.add(line);
      }
    }
  }
  for (let node = 0; node < graph.count; node++) {
    const group = groupOf(node);
    if (group < 0) continue;
    const hash = graph.stringHash.get(node);
    if (hash !== undefined && retainedStringHashes.has(hash)) continue;
    if (hash !== undefined) order.groups[group]!.afterRetained.push("CSTR;" + hash);
    else if (isNamed(node)) {
      const names = namesOf(node).filter(([object, name]) => namesOnlyMovedNodes(node, object, name));
      if (names.length === 0) continue;
      for (const [, name] of names) {
        const line = lineOf(node, name);
        if (written.has(line)) continue;
        written.add(line);
        order.groups[lastGroupOfLine.get(line)!]![linesAfterRetained.has(line) ? "afterRetained" : "names"].push(
          spell(graph.object[node]!, name),
        );
      }
    }
    order.nodes.push(node);
  }
  return order;
}

export function machO(linker: Linker): LinkerFormat {
  const { work, output, command } = linker;
  const exportedSymbolsAt = command.indexOf(exportedSymbolsFlag);
  const exportedSymbols = exportedSymbolsAt < 0 ? undefined : command[exportedSymbolsAt + 1];
  if (exportedSymbols === undefined) throw new BuildError(`the link command names no ${exportedSymbolsFlag}`);
  const orderAt = command.findIndex(argument => argument.startsWith(orderFlag));
  const compiledFolderAt = command.findIndex(argument => argument.startsWith(compiledFolderFlag));
  const commandOrder = orderAt >= 0 ? readFileSync(command[orderAt]!.slice(orderFlag.length), "latin1") : "";
  const orderFile = join(work, "order.txt");
  const compiled = join(work, "compiled");
  const unused = join(work, "unused");
  mkdirSync(compiled, { recursive: true });
  mkdirSync(unused, { recursive: true });
  const listCompiledObjects = () =>
    readdirSync(compiled)
      .sort()
      .map(name => join(compiled, name));
  const createLinkArguments = (compiledFolder: string): LinkArguments => {
    const flag = compiledFolderFlag + compiledFolder;
    if (compiledFolderAt >= 0) return { last: [headerPadFlag], replaced: new Map([[compiledFolderAt, flag]]) };
    return { last: [headerPadFlag, flag], replaced: new Map() };
  };
  return {
    relinksSameInputs: false,
    firstInputs: linker.inputs.filter(path => hasMachOSection(path, "__bun_builtins")),
    builtinModulesOutput: "__TEXT,__bun_builtins",
    isMovable,
    canBeFilled: output =>
      /^__TEXT,__(text|const|bun_builtins|cstring|literals)$/.test(output) || isOneUnitOfAssembly(output),
    isCode: output => output === "__TEXT,__text" || isOneUnitOfAssembly(output),
    supportObjects: room => [linker.assemble("room.s", roomSource(room))],
    prepareInput: path => path,
    prepareCompiledObjects: () => false,
    compiledObjects: listCompiledObjects,
    firstLinkArguments: () => createLinkArguments(compiled),
    secondLinkArguments(order) {
      const linesAfterGroupNames = [
        ...order.retainedFirst,
        ...[...order.groups].reverse().flatMap(group => group.afterRetained),
      ];
      writeFileSync(
        orderFile,
        [...order.groups.flatMap(group => group.names), ...linesAfterGroupNames].join("\n") + "\n" + commandOrder,
        "latin1",
      );
      const result = createLinkArguments(unused);
      if (orderAt >= 0) result.replaced.set(orderAt, orderFlag + orderFile);
      else result.last.push(orderFlag + orderFile);
      return result;
    },
    read: link => readMachOGraph(link.executable, link.map, listCompiledObjects(), exportedSymbols),
    namedBytes: () => undefined,
    orderOf,
    nameUnnamedSections: () => new Map(),
    writeTable(table) {
      const fd = openSync(resolve(output), "r+");
      try {
        writeTableIntoSection(fd, table, output, trimTableSection, findMachOSection(fd, trimTableSection));
      } finally {
        closeSync(fd);
      }
    },
    // The executable's debug map names the objects in `compiled`, and dsymutil reads them after the link.
    tidyUp() {},
  };
}
