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
    nodes: [],
    unnamed: new Map(),
  };
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
