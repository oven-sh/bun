import type { GraphReading, SectionGraph } from "./graph.ts";
import type { NamedBytes } from "./icu-data.ts";
import type { Partition } from "./partition.ts";
import type { OutputPolicy } from "./ranges.ts";

export type LinkName = "first" | "second";

export interface Link {
  name: LinkName;
  executable: string;
  map: string;
  log: string;
}

export interface LinkArguments {
  last: string[];
  // Index into Linker.command → the argument this link gets there.
  replaced: Map<number, string>;
  without?: RegExp;
}

export interface LinkRequest extends LinkArguments {
  name: LinkName;
  // Called per input of a response file. undefined leaves the input out.
  rewrite(path: string): string | undefined;
  first: string[];
}

export interface Linker {
  work: string;
  firstLinkName: string;
  output: string;
  command: readonly string[];
  inputs: readonly string[];
  assemble(name: string, text: string): string;
  link(request: LinkRequest): Link;
}

export interface OrderGroup {
  set: number;
  names: string[];
  // Mach-O: order lines that must follow the lines of retained atoms.
  afterRetained: string[];
}

export interface SectionOrder {
  retainedFirst: string[];
  // Parallel to Partition.groups.
  groups: OrderGroup[];
  nodes: number[];
  // Object → section → index into `groups`.
  unnamed: Map<string, Map<string, number>>;
}

export interface LinkerFormat extends OutputPolicy {
  relinksSameInputs: boolean;
  firstInputs: string[];
  builtinModulesOutput: string;
  supportObjects(tableRoom: number): string[];
  prepareInput(path: string): string;
  // true: the objects changed, so they are linked instead of the bitcode before the graph is read.
  prepareCompiledObjects(objects: string[]): boolean;
  compiledObjects(link: "first" | "second"): string[];
  firstLinkArguments(): LinkArguments;
  secondLinkArguments(order: SectionOrder): LinkArguments;
  read(link: Link): GraphReading;
  namedBytes(link: Link): NamedBytes | undefined;
  orderOf(graph: SectionGraph, partition: Partition): SectionOrder;
  // Adds the new names to `order`. Returns original path → edited copy.
  nameUnnamedSections(order: SectionOrder, writable: string[]): Map<string, string>;
  writeTable(table: Buffer): void;
  tidyUp(): void;
}
