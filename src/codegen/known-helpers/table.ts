import type { FoundFunction, FoundReference } from "./definitions.ts";
import { comparePublications, type FetchedVersion } from "./fetch.ts";
import { compareVersions, isRelease, minorOf, parseVersion, toolOf } from "./packages.ts";
import type { NamedShape } from "./shapes.ts";

export interface Occurrence {
  readonly tool: string;
  readonly version: string;
  readonly publishedAt: string;
  readonly publishedName: string;
  readonly part: number;
  readonly partCount: number;
  readonly where: string;
}

export interface Tree {
  readonly tree: string;
  readonly text: string;
  readonly unsupported: string | undefined;
  readonly references: readonly FoundReference[];
  readonly occurrences: Occurrence[];
}

export interface VersionRead {
  readonly version: FetchedVersion;
  readonly found: readonly FoundFunction[];
}

export type Reference =
  | { readonly kind: "itself" }
  | { readonly kind: "helper"; readonly helper: string }
  | { readonly kind: "global"; readonly path: readonly string[] }
  | { readonly kind: "operand" };

export interface TableEntry {
  readonly line: NamedShape;
  readonly tree: Tree;
  readonly references: readonly (readonly [string, Reference])[];
  readonly origin: string;
}

export interface Table {
  readonly entries: readonly TableEntry[];
  readonly unnamed: readonly Tree[];
  readonly complaints: readonly string[];
  readonly versionsRead: ReadonlyMap<string, readonly string[]>;
}

export function mergeTrees(read: readonly VersionRead[]): Map<string, Tree> {
  const inOrder = [...read].sort((a, b) => comparePublications(a.version, b.version));
  const trees = new Map<string, Tree>();
  for (const { version, found } of inOrder) {
    for (const one of found) {
      let tree = trees.get(one.tree);
      if (tree === undefined) {
        tree = { tree: one.tree, text: one.text, unsupported: one.unsupported, references: one.references, occurrences: [] };
        trees.set(one.tree, tree);
      }
      tree.occurrences.push({
        tool: toolOf(version.name),
        version: version.version,
        publishedAt: version.publishedAt,
        publishedName: one.publishedName,
        part: one.part,
        partCount: one.partCount,
        where: one.where,
      });
    }
  }
  return trees;
}

function hasOneReleaseOfEachMinor(versions: readonly string[]): boolean {
  const minors = versions.filter(version => isRelease(parseVersion(version)!)).map(minorOf);
  return new Set(minors).size === minors.length;
}

export function originOf(tree: Tree, versionsRead: ReadonlyMap<string, readonly string[]>): string {
  const tools: string[] = [];
  for (const occurrence of tree.occurrences) if (!tools.includes(occurrence.tool)) tools.push(occurrence.tool);
  return tools
    .map(tool => {
      const versions = versionsRead.get(tool)!;
      const namesMinors = hasOneReleaseOfEachMinor(versions);
      const short = (version: string) => (namesMinors && isRelease(parseVersion(version)!) ? minorOf(version)! : version);
      const has = new Set(tree.occurrences.filter(occurrence => occurrence.tool === tool).map(occurrence => occurrence.version));
      const ranges: string[][] = [];
      let open: string[] | undefined;
      for (const version of versions) {
        if (!has.has(version)) open = undefined;
        else if (open) open[1] = version;
        else ranges.push((open = [version, version]));
      }
      const written = ranges.map(([first, last]) => (first === last ? short(first) : `${short(first)} to ${short(last)}`));
      return `${tool} ${written.join(", ")}`;
    })
    .join("; ");
}

interface Publication {
  readonly tool: string;
  readonly version: string;
}

function publicationOf(line: NamedShape): Publication {
  const at = line.firstPublishedIn.lastIndexOf("@");
  return { tool: toolOf(line.firstPublishedIn.slice(0, at)), version: line.firstPublishedIn.slice(at + 1) };
}

export function toolOfLine(line: NamedShape): string {
  return publicationOf(line).tool;
}

function placeOf(publication: Publication, publishedName: string, part: number): string {
  return `${publication.tool}@${publication.version} ${publishedName} ${part}`;
}

export function describeLine(line: NamedShape): string {
  const part = line.part === undefined ? "" : `, part ${line.part}`;
  const where = line.where === undefined ? "" : `, ${line.where}`;
  return `${line.shape} (${line.publishedName} of ${line.firstPublishedIn}${part}${where})`;
}

export function buildTable(read: readonly VersionRead[], lines: readonly NamedShape[]): Table {
  const trees = mergeTrees(read);
  const complaints: string[] = [];
  const versionsRead = new Map<string, string[]>();
  for (const { version } of read) {
    const versions = versionsRead.get(toolOf(version.name)) ?? [];
    versions.push(version.version);
    versionsRead.set(toolOf(version.name), versions.sort(compareVersions));
  }

  const treesByPlace = new Map<string, Map<Tree, Occurrence[]>>();
  for (const tree of trees.values()) {
    for (const occurrence of tree.occurrences) {
      const place = placeOf(occurrence, occurrence.publishedName, occurrence.part);
      let there = treesByPlace.get(place);
      if (there === undefined) treesByPlace.set(place, (there = new Map()));
      const occurrences = there.get(tree);
      if (occurrences === undefined) there.set(tree, [occurrence]);
      else occurrences.push(occurrence);
    }
  }

  const lineOfTree = new Map<string, NamedShape>();
  const treeOfLine = new Map<NamedShape, Tree>();
  const helperOfShape = new Map<string, string>();
  for (const line of lines) {
    const known = helperOfShape.get(line.shape);
    if (known !== undefined && known !== line.helper) complaints.push(`${line.shape} is listed under ${known} and under ${line.helper}`);
    helperOfShape.set(line.shape, line.helper);
    const publication = publicationOf(line);
    if (!versionsRead.get(publication.tool)?.includes(publication.version)) {
      complaints.push(`${describeLine(line)}: that version was not read`);
      continue;
    }
    const candidates: (readonly [Tree, Occurrence])[] = [];
    for (const [tree, occurrences] of treesByPlace.get(placeOf(publication, line.publishedName, line.part ?? 1)) ?? []) {
      const occurrence = occurrences.find(occurrence => line.where === undefined || occurrence.where.includes(line.where));
      if (occurrence !== undefined) candidates.push([tree, occurrence]);
    }
    if (candidates.length !== 1) {
      complaints.push(
        candidates.length === 0
          ? `${describeLine(line)}: nothing was published there under that name`
          : `${describeLine(line)}: ${candidates.length} trees were published there; say where: ${candidates.map(([, occurrence]) => occurrence.where).join(" | ")}`,
      );
      continue;
    }
    const [[tree]] = candidates;
    const other = lineOfTree.get(tree.tree);
    if (other !== undefined) {
      complaints.push(`${describeLine(line)} is the same tree as ${describeLine(other)}`);
      continue;
    }
    const first = tree.occurrences[0];
    if (first.tool !== publication.tool || first.version !== publication.version) {
      complaints.push(`${describeLine(line)} was first published in ${first.tool}@${first.version} as ${first.publishedName}`);
    }
    if (tree.unsupported !== undefined) {
      complaints.push(`${describeLine(line)} has ${tree.unsupported}, which the comparison does not read`);
      continue;
    }
    lineOfTree.set(tree.tree, line);
    treeOfLine.set(line, tree);
  }

  let entries: TableEntry[] = [];
  for (const line of lines) {
    const tree = treeOfLine.get(line);
    if (tree === undefined) continue;
    const references: [string, Reference][] = [];
    let isComplete = true;
    for (const reference of tree.references) {
      if (reference.kind === "itself") references.push([reference.name, { kind: "itself" }]);
      else if (reference.kind === "global") references.push([reference.name, { kind: "global", path: reference.path }]);
      else if (reference.kind === "operand") references.push([reference.name, { kind: "operand" }]);
      else if (reference.kind === "unknown") {
        complaints.push(`${describeLine(line)} refers to ${reference.name}: ${reference.why}`);
        isComplete = false;
      } else {
        const helpers = new Set(reference.trees.map(tree => lineOfTree.get(tree)?.helper));
        const [helper] = helpers;
        if (helpers.size !== 1 || helper === undefined) {
          complaints.push(`${describeLine(line)} refers to ${reference.name}, which has no name or more than one`);
          isComplete = false;
        } else references.push([reference.name, { kind: "helper", helper }]);
      }
    }
    if (isComplete) entries.push({ line, tree, references, origin: originOf(tree, versionsRead) });
  }
  for (let count = -1; count !== entries.length; ) {
    count = entries.length;
    const helpers = new Set(entries.map(entry => entry.line.helper));
    entries = entries.filter(entry => {
      const missing = entry.references.find(([, reference]) => reference.kind === "helper" && !helpers.has(reference.helper));
      if (missing !== undefined) complaints.push(`${describeLine(entry.line)} refers to ${missing[0]}, none of whose trees is in the table`);
      return missing === undefined;
    });
  }

  const unnamed = [...trees.values()].filter(tree => !lineOfTree.has(tree.tree));
  return { entries, unnamed, complaints, versionsRead };
}
