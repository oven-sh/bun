import fs from "node:fs";
import path from "node:path";
import type { Effects, Entry, Heap, RuntimeOperation, Schema } from "./model.ts";
import { entriesOf, isIntrinsic } from "./model.ts";
import { cppGenerateFunctionName, cppRuntimeFunctionName, rustIdentifier } from "./names.ts";
import { compareLocations, type Location } from "./source.ts";

export interface UnusedName {
  readonly location: Location;
  readonly spelling: string;
}

interface NameToFind {
  readonly location: Location;
  readonly spellings: readonly string[];
  readonly minimum: number;
}

interface WordCounts {
  readonly counts: Map<string, number>;
  readonly pastedPrefixes: Set<string>;
}

const sourceExtensions: ReadonlySet<string> = new Set([".cpp", ".h", ".rs"]);
const generatedFolderName = "generated";
const emitterFileName = /^emit-.+\.ts$/;
const operationPrologueMacro = "AOT_OPERATION_BEGIN";
const searchedEnumNames: ReadonlySet<string> = new Set([
  "LimitID",
  "StatisticID",
  "PassID",
  "UserDiagnosticKind",
  "InternalErrorKind",
]);

function sourceFilesUnder(directory: string): string[] {
  if (fs.statSync(directory).isFile()) return [directory];
  return fs
    .readdirSync(directory, { encoding: "utf8", recursive: true })
    .filter(file => sourceExtensions.has(path.extname(file)) && !file.split(path.sep).includes(generatedFolderName))
    .sort()
    .map(file => path.join(directory, file));
}

function emitterFiles(): string[] {
  const directory = import.meta.dirname;
  return fs
    .readdirSync(directory)
    .filter(file => emitterFileName.test(file))
    .sort()
    .map(file => path.join(directory, file));
}

function countWords(text: string, words: WordCounts): void {
  const { counts, pastedPrefixes } = words;
  const count = (word: string) => counts.set(word, (counts.get(word) ?? 0) + 1);
  const identifier = /[A-Za-z_]\w*/g;
  const pasteOperator = /[ \t]*##/y;
  let previous: RegExpExecArray | null = null;
  for (let match = identifier.exec(text); match !== null; match = identifier.exec(text)) {
    if (match[0].startsWith(operationPrologueMacro)) {
      const lineEnd = text.indexOf("\n", identifier.lastIndex);
      identifier.lastIndex = lineEnd < 0 ? text.length : lineEnd;
      previous = null;
      continue;
    }
    count(match[0]);
    if (previous !== null && text.slice(previous.index + previous[0].length, match.index) === "::") {
      const qualifiedName = `${previous[0]}::${match[0]}`;
      count(qualifiedName);
      pasteOperator.lastIndex = identifier.lastIndex;
      if (pasteOperator.test(text)) pastedPrefixes.add(qualifiedName);
    }
    previous = match;
  }
}

function heapsNamedByEffects(schema: Schema): Set<Heap> {
  const owners: readonly { readonly effects: Effects }[] = [
    ...entriesOf(schema),
    ...schema.runtimeOperations,
    ...schema.inlineBuiltins,
    ...schema.namedEffects,
  ];
  const references = owners.flatMap(({ effects }) => [...effects.reads, ...effects.writes]);
  return new Set(references.map(reference => reference.heap));
}

function entrySpellingsOf(entry: Entry): string[] {
  const enumerator = `${entry.isTerminator ? "TerminatorKind" : "Opcode"}::${entry.name}`;
  return entry.isWire ? [enumerator, rustIdentifier(entry.name)] : [enumerator];
}

function spellingsOf(schema: Schema): NameToFind[] {
  const names: NameToFind[] = [];
  for (const type of schema.enums) {
    if (!searchedEnumNames.has(type.name)) continue;
    for (const member of type.members.slice(1)) {
      if (member.isFromExtension) continue;
      const spellings = [`${type.name}::${member.name}`, member.name];
      names.push({ location: member.location, spellings, minimum: 1 });
    }
  }
  for (const entry of entriesOf(schema)) {
    if (isIntrinsic(entry)) continue;
    names.push({ location: entry.location, spellings: entrySpellingsOf(entry), minimum: 1 });
  }
  for (const builtin of schema.inlineBuiltins) {
    const spellings = [`InlineBuiltin::${builtin.name}`, cppGenerateFunctionName(builtin.name)];
    names.push({ location: builtin.location, spellings, minimum: 1 });
  }
  const namedByEffects = heapsNamedByEffects(schema);
  for (const heap of schema.heaps) {
    if (namedByEffects.has(heap)) continue;
    names.push({ location: heap.location, spellings: [`AbstractHeap::${heap.name}`], minimum: 1 });
  }
  return names;
}

function runtimeOperationSpellingsOf(operation: RuntimeOperation): readonly [NameToFind, NameToFind] {
  const { location, name } = operation;
  return [
    { location, spellings: [`RuntimeOperation::${name}`], minimum: 1 },
    { location, spellings: [cppRuntimeFunctionName(name)], minimum: 2 },
  ];
}

function startsWithPastedPrefix(spelling: string, words: WordCounts): boolean {
  for (const prefix of words.pastedPrefixes) {
    if (spelling.startsWith(prefix)) return true;
  }
  return false;
}

function isUsed(name: NameToFind, words: WordCounts): boolean {
  return name.spellings.some(
    spelling => (words.counts.get(spelling) ?? 0) >= name.minimum || startsWithPastedPrefix(spelling, words),
  );
}

export function findUnusedNames(schema: Schema, directories: readonly string[]): UnusedName[] {
  const words: WordCounts = { counts: new Map(), pastedPrefixes: new Set() };
  for (const file of [...emitterFiles(), ...directories.flatMap(sourceFilesUnder)]) {
    countWords(fs.readFileSync(file, "utf8"), words);
  }
  const unused: UnusedName[] = [];
  for (const operation of schema.runtimeOperations) {
    const [enumerator, functionName] = runtimeOperationSpellingsOf(operation);
    if (isUsed(enumerator, words) || isUsed(functionName, words)) continue;
    unused.push({ location: operation.location, spelling: enumerator.spellings[0] });
  }
  for (const name of spellingsOf(schema)) {
    if (!isUsed(name, words)) unused.push({ location: name.location, spelling: name.spellings[0] });
  }
  const compare = compareLocations(schema.files);
  return unused.sort((left, right) => compare(left.location, right.location));
}
