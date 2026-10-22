import type {
  Constant,
  Entry,
  EntryColumn,
  EntryColumnValue,
  EnumColumn,
  External,
  Field,
  GeneratedEnumName,
  Heap,
  IdKind,
  InlineBuiltin,
  Member,
  NamedEffects,
  NaturalTable,
  OpaqueKind,
  ProgramList,
  RuntimeOperation,
  Schema,
  SchemaEnum,
  SchemaFile,
  SchemaRecord,
  SchemaType,
  Variant,
  VariantCase,
} from "./model.ts";
import { effectRules, forms, generatedEnumNames, operandClasses, resultRules } from "./model.ts";
import { programListMemberName } from "./names.ts";
import { declarationsInOrder, type DeclarationInFile } from "./parse.ts";
import {
  assignPayloadWords,
  resolveEffects,
  resolveEntries,
  resolveEntryColumns,
  resolveHeaps,
  resolveInlineBuiltins,
  resolveRuntimeOperations,
} from "./resolve-entries.ts";
import { resolveNaturalTables } from "./resolve-results.ts";
import {
  applyExtensions,
  computeWords,
  declareTypes,
  findKind,
  markPayloadTypes,
  resolveEnums,
  resolveIdKinds,
  resolveLists,
  resolveRecords,
} from "./resolve-types.ts";
import { ErrorList, type Location } from "./source.ts";
import type { Declaration, Name, ParameterSyntax, ParsedFile, UseSyntax } from "./syntax.ts";

export type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
export type MutableEnum = Mutable<SchemaEnum> & { members: Member[]; columns: EnumColumn[] };
export type MutableRecord = Mutable<SchemaRecord> & { fields: Field[]; wireFields: Field[] };
export type MutableVariant = Mutable<Variant> & { cases: VariantCase[] };
export type MutableEntry = Mutable<Entry> & { columns: Map<string, EntryColumnValue> };

export interface NamedSets {
  readonly effects: Map<string, NamedEffects>;
  readonly uses: Map<string, readonly UseSyntax[]>;
  readonly groups: Map<string, readonly ParameterSyntax[]>;
}

interface MemberSource {
  readonly name: string;
  readonly isEngine: boolean;
  readonly location: Location | null;
}

interface Located {
  readonly name: string;
  readonly location: Location;
}

const requiredEnums = [
  "IRForm",
  "ResultRule",
  "EffectRule",
  "OperandKind",
  "PayloadKind",
  "FunctionReferenceKind",
  "ModuleReferenceKind",
  "RetainedIn",
] as const;
const requiredFlagWords = ["OperandUse", "Protocol"] as const;
const requiredMemberOrders: readonly (readonly [string, readonly string[]])[] = [
  ["IRForm", forms],
  ["ResultRule", resultRules],
  ["EffectRule", effectRules],
];
const kindClassWords: ReadonlySet<string> = new Set(["Enum", "Flags", "External", "Record", "Variant", "List"]);

export class Scope {
  readonly errors = new ErrorList();
  readonly files: SchemaFile[];
  readonly constants = new Map<string, Constant>();
  readonly enums = new Map<string, MutableEnum>();
  readonly externals = new Map<string, External>();
  readonly opaqueKinds = new Map<string, OpaqueKind>();
  readonly records = new Map<string, MutableRecord>();
  readonly variants = new Map<string, MutableVariant>();
  readonly lists = new Map<string, ProgramList>();
  readonly idKinds = new Map<string, IdKind>();
  readonly heaps = new Map<string, Heap>();
  readonly namedSets: NamedSets = { effects: new Map(), uses: new Map(), groups: new Map() };
  readonly families: string[] = [];
  readonly inlineFamilies: string[] = [];
  readonly naturalTables = new Map<string, NaturalTable>();
  readonly entryColumns = new Map<string, EntryColumn>();
  readonly runtimeOperations = new Map<string, RuntimeOperation>();
  readonly entries = new Map<string, MutableEntry>();
  readonly inlineBuiltins = new Map<string, InlineBuiltin>();

  constructor(files: readonly ParsedFile[]) {
    this.files = [...files];
  }

  declare<T>(
    table: Map<string, T>,
    name: Name,
    value: T,
    alsoTakenIn: readonly ReadonlyMap<string, unknown>[] = [],
  ): void {
    if (table.has(name.text) || alsoTakenIn.some(other => other.has(name.text))) {
      this.errors.add(name.location, `${name.text} is declared twice`);
      return;
    }
    table.set(name.text, value);
  }
}

function locationOf(declaration: Declaration): Location {
  switch (declaration.declares) {
    case "include":
      return declaration.location;
    case "opaque":
    case "runtime":
      return declaration.names[0].location;
    case "extend":
      return declaration.target.location;
    case "inline":
      return declaration.entries[0].name.location;
    case "constant":
    case "heap":
    case "effects":
    case "uses":
    case "parameters":
    case "external":
    case "enum":
    case "flags":
    case "record":
    case "variant":
    case "list":
    case "natural":
    case "column":
    case "family":
    case "operation":
    case "terminator":
      return declaration.name.location;
  }
}

function firstLocationOf(file: ParsedFile): Location {
  const first = file.declarations.at(0);
  return first === undefined ? { path: file.path, line: 1, column: 1 } : locationOf(first);
}

function checkVocabulary(scope: Scope, location: Location): void {
  for (const name of requiredEnums) {
    if (scope.enums.get(name)?.isFlags !== false) scope.errors.add(location, `the schema has no enum ${name}`);
  }
  for (const name of requiredFlagWords) {
    if (scope.enums.get(name)?.isFlags !== true) scope.errors.add(location, `the schema has no flag word ${name}`);
  }
  for (const [name, order] of requiredMemberOrders) {
    const type = scope.enums.get(name);
    if (type === undefined) continue;
    const { members } = type;
    const isInOrder = members.length === order.length && members.every((member, index) => member.name === order[index]);
    if (!isInOrder) scope.errors.add(type.location, `the members of ${name} are not in the generator's order`);
  }
  for (const { name, location: memberLocation } of scope.enums.get("PayloadKind")?.members ?? []) {
    if (kindClassWords.has(name) || findKind(scope, name, "payload") !== null) continue;
    scope.errors.add(memberLocation, `enum PayloadKind has the member ${name}, which the generator does not implement`);
  }
}

function checkTypeWords(scope: Scope): void {
  const builtinClasses = scope.externals.get("BuiltinClass")?.members ?? [];
  const enums = [...scope.enums.values()].filter(type => !type.isFlags && !type.isGenerated);
  const typeWords: readonly Located[] = [...enums, ...scope.opaqueKinds.values(), ...scope.naturalTables.values()];
  for (const { name, location } of typeWords) {
    if (builtinClasses.includes(name)) scope.errors.add(location, `${name} is also a member of BuiltinClass`);
  }
}

function resolveNamedSets(scope: Scope, declarations: readonly DeclarationInFile[]): void {
  const { effects, uses, groups } = scope.namedSets;
  for (const { declaration } of declarations) {
    if (declaration.declares === "effects") {
      const { name } = declaration;
      const set: NamedEffects = {
        name: name.text,
        number: effects.size,
        effects: resolveEffects(scope, declaration.effects, [], name.text),
        location: name.location,
      };
      scope.declare(effects, name, set, [uses, groups]);
    } else if (declaration.declares === "uses") {
      const expanded = declaration.uses.flatMap(use => uses.get(use.name.text) ?? [use]);
      scope.declare(uses, declaration.name, expanded, [effects, groups]);
    } else if (declaration.declares === "parameters") {
      scope.declare(groups, declaration.name, declaration.parameters, [effects, uses]);
    }
  }
}

function wireFirst<Item>(items: readonly Item[], isEngine: (item: Item) => boolean): Item[] {
  return [...items.filter(item => !isEngine(item)), ...items.filter(isEngine)];
}

function assignNumbers(items: Iterable<{ number: number }>): void {
  let number = 0;
  for (const item of items) {
    item.number = number;
    number += 1;
  }
}

function replaceContents<Item extends Located>(table: Map<string, Item>, items: readonly Item[]): void {
  table.clear();
  for (const item of items) table.set(item.name, item);
}

function numberEverything(scope: Scope): void {
  for (const type of scope.enums.values()) {
    type.members = wireFirst(type.members, member => member.isEngine);
    type.wireMemberCount = type.members.filter(member => !member.isEngine).length;
    assignNumbers(type.members);
  }
  const entries = [...scope.entries.values()];
  const isEngineEntry = (entry: Entry) => !entry.isWire;
  const operations = wireFirst(
    entries.filter(entry => !entry.isTerminator),
    isEngineEntry,
  );
  const terminators = wireFirst(
    entries.filter(entry => entry.isTerminator),
    isEngineEntry,
  );
  assignNumbers(operations);
  assignNumbers(terminators);
  replaceContents(scope.entries, [...operations, ...terminators]);
  replaceContents(
    scope.opaqueKinds,
    wireFirst([...scope.opaqueKinds.values()], kind => kind.isEngine),
  );
  const { opaqueKinds, heaps, lists, runtimeOperations, inlineBuiltins, naturalTables, namedSets } = scope;
  const tables: readonly ReadonlyMap<string, { number: number }>[] = [
    opaqueKinds,
    heaps,
    lists,
    runtimeOperations,
    inlineBuiltins,
    naturalTables,
    namedSets.effects,
  ];
  for (const table of tables) assignNumbers(table.values());
}

function makeGeneratedEnums(scope: Scope): void {
  const entries = [...scope.entries.values()];
  const entrySources = (isTerminator: boolean): MemberSource[] =>
    entries
      .filter(entry => entry.isTerminator === isTerminator)
      .map(({ name, isWire, location }) => ({ name, isEngine: !isWire, location }));
  const engineSources = (items: Iterable<Located>): MemberSource[] =>
    Array.from(items, ({ name, location }) => ({ name, isEngine: true, location }));
  const engineWords = (names: readonly string[]): MemberSource[] =>
    names.map(name => ({ name, isEngine: true, location: null }));
  const sources: Readonly<Record<GeneratedEnumName, readonly MemberSource[]>> = {
    Opcode: entrySources(false),
    TerminatorKind: entrySources(true),
    OperationFamily: engineWords(scope.families),
    AbstractHeap: engineSources(scope.heaps.values()),
    OpaqueKind: [...scope.opaqueKinds.values()],
    ProgramList: Array.from(scope.lists.values(), ({ name, location }) => ({
      name: programListMemberName(name),
      isEngine: false,
      location,
    })),
    InlineBuiltin: engineSources(scope.inlineBuiltins.values()),
    InlineBuiltinFamily: engineWords(scope.inlineFamilies),
    RuntimeOperation: engineSources(scope.runtimeOperations.values()),
    NaturalTable: engineSources(scope.naturalTables.values()),
    OperandClass: engineWords(operandClasses),
    NamedEffectSet: engineSources(scope.namedSets.effects.values()),
  };
  for (const typeName of generatedEnumNames) {
    const type = scope.enums.get(typeName);
    if (type === undefined) throw new Error(`the generated enum ${typeName} was not declared`);
    type.members = sources[typeName].map(({ name, isEngine, location }, number) => ({
      name,
      number,
      isEngine,
      isFromExtension: false,
      values: [],
      location: location ?? type.location,
    }));
    type.wireMemberCount = type.members.filter(member => !member.isEngine).length;
  }
}

function typesInOrder(scope: Scope, declarations: readonly DeclarationInFile[]): SchemaType[] {
  return declarations.flatMap(({ declaration }): SchemaType[] => {
    if (declaration.declares === "record") {
      const record = scope.records.get(declaration.name.text);
      return record === undefined ? [] : [{ tag: "Record", record }];
    }
    if (declaration.declares === "variant") {
      const variant = scope.variants.get(declaration.name.text);
      return variant === undefined ? [] : [{ tag: "Variant", variant }];
    }
    return [];
  });
}

function buildSchema(scope: Scope, declarations: readonly DeclarationInFile[]): Schema {
  const enums = [...scope.enums.values()];
  const entries = [...scope.entries.values()];
  const generatedEnums = new Map<GeneratedEnumName, SchemaEnum>();
  for (const name of generatedEnumNames) {
    const type = scope.enums.get(name);
    if (type !== undefined) generatedEnums.set(name, type);
  }
  return {
    files: scope.files,
    constants: [...scope.constants.values()],
    enums: enums.filter(type => !type.isFlags && !type.isGenerated),
    flagWords: enums.filter(type => type.isFlags),
    generatedEnums,
    idKinds: [...scope.idKinds.values()],
    externals: [...scope.externals.values()],
    types: typesInOrder(scope, declarations),
    lists: [...scope.lists.values()],
    heaps: [...scope.heaps.values()],
    opaqueKinds: [...scope.opaqueKinds.values()],
    naturalTables: [...scope.naturalTables.values()],
    namedEffects: [...scope.namedSets.effects.values()],
    entryColumns: [...scope.entryColumns.values()],
    families: scope.families,
    inlineFamilies: scope.inlineFamilies,
    operations: entries.filter(entry => !entry.isTerminator),
    terminators: entries.filter(entry => entry.isTerminator),
    runtimeOperations: [...scope.runtimeOperations.values()],
    inlineBuiltins: [...scope.inlineBuiltins.values()],
  };
}

export function resolveSchema(files: readonly ParsedFile[]): Schema {
  const scope = new Scope(files);
  const declarations = declarationsInOrder(files);
  declareTypes(scope, declarations);
  resolveEnums(scope, declarations);
  applyExtensions(scope, declarations);
  resolveLists(scope, declarations);
  resolveIdKinds(scope);
  resolveRecords(scope, declarations);
  checkVocabulary(scope, firstLocationOf(files[0]));
  resolveHeaps(scope, declarations);
  resolveNamedSets(scope, declarations);
  resolveNaturalTables(scope, declarations);
  checkTypeWords(scope);
  resolveEntryColumns(scope, declarations);
  resolveRuntimeOperations(scope, declarations);
  resolveEntries(scope, declarations);
  resolveInlineBuiltins(scope, declarations);
  numberEverything(scope);
  makeGeneratedEnums(scope);
  markPayloadTypes(scope);
  computeWords(scope);
  assignPayloadWords(scope);
  scope.errors.throwIfAny(scope.files);
  return buildSchema(scope, declarations);
}
