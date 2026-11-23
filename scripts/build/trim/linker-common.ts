import { readdirSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { BuildError } from "../error.ts";
import type { SectionGraph } from "./graph.ts";
import type { SectionOrder } from "./linker.ts";
import type { Partition } from "./partition.ts";

export interface FileRange {
  offset: number;
  size: number;
}

export function groupOfNode(
  graph: SectionGraph,
  partition: Partition,
  isMovable: (output: string) => boolean,
  node: number,
): number {
  if (partition.isRetained[node] || !isMovable(graph.output[node]!)) return -1;
  return partition.groupOfSet.get(partition.setOf[node]!) ?? -1;
}

export function createSectionOrder(partition: Partition): SectionOrder {
  return {
    retainedFirst: [],
    groups: partition.groups.map(({ set }) => ({ set, names: [], afterRetained: [] })),
    groupsOutsidePrograms: partition.groupsOutsidePrograms,
    nodes: [],
    unnamed: new Map(),
  };
}

/** The lines of an order file from another build, with this build's ThinLTO suffixes and hashes of Rust crates. */
export function underCurrentNames(
  orderFile: string,
  graph: Pick<SectionGraph, "names" | "section" | "aliases">,
): string[] {
  const aliases = [...graph.aliases.values()].flat().map(([, name]) => name);
  const defined = new Set([...graph.names.flat(), ...graph.section, ...aliases]);
  // Back-references are positions in the name, and hashes differ in length.
  const stem = (name: string) =>
    name.replace(/^_?_R/.test(name) ? /\.llvm\.\d+$|Cs[\da-zA-Z]+_|B[\da-zA-Z]{0,2}_/g : /\.llvm\.\d+$/, "");
  const byStem = new Map<string, string[]>();
  for (const name of defined) byStem.set(stem(name), [...(byStem.get(stem(name)) ?? []), name]);
  const lines = orderFile.split(/\r?\n/).filter(line => line !== "");
  return [...new Set(lines.flatMap(line => (defined.has(line) ? line : (byStem.get(stem(line)) ?? line))))];
}

export function findCompiledObjects(directories: Iterable<string>, executableName: string): string[] {
  const firstSpellingOf = new Map<string, string>();
  for (const directory of directories) {
    if (!firstSpellingOf.has(resolve(directory))) firstSpellingOf.set(resolve(directory), directory);
  }
  return [...firstSpellingOf.values()].flatMap(directory =>
    readdirSync(directory)
      .filter(file => file.startsWith(executableName + ".lto."))
      .sort()
      .map(file => join(directory, file)),
  );
}

export function writeTableIntoSection(
  fd: number,
  table: Buffer,
  output: string,
  sectionName: string,
  section: FileRange | undefined,
): void {
  if (section === undefined) throw new BuildError(`${output} has no section ${sectionName}`);
  if (section.size < table.length) {
    throw new BuildError(
      `the trim table has ${table.length} bytes, section ${sectionName} has room for ${section.size}`,
    );
  }
  writeSync(fd, table, 0, table.length, section.offset);
}
