import type { Location } from "./source.ts";

export const forms = ["AsRead", "Prepared", "Selected", "Placed"] as const;
export type Form = (typeof forms)[number];

export const recordForms = ["wire", "abi", "engine"] as const;
export type RecordForm = (typeof recordForms)[number];

export const scalarKinds = [
  "Bool",
  "UInt8",
  "UInt32",
  "UInt64",
  "Int64",
  "Double",
  "Field",
  "Byte",
  "Word",
  "CodeWord",
] as const;
export type ScalarKind = (typeof scalarKinds)[number];

export const placedWordKinds = ["Request", "StaticsOffset", "OrderWord"] as const;
export type PlacedWordKind = (typeof placedWordKinds)[number];

export const generatedEnumNames = [
  "Opcode",
  "TerminatorKind",
  "OperationFamily",
  "AbstractHeap",
  "OpaqueKind",
  "ProgramList",
  "InlineBuiltin",
  "InlineBuiltinFamily",
  "RuntimeOperation",
  "NaturalTable",
  "OperandClass",
  "NamedEffectSet",
] as const;
export type GeneratedEnumName = (typeof generatedEnumNames)[number];

export const operandClasses = ["NumberLike", "BigInt", "String", "Any"] as const;
export type OperandClass = (typeof operandClasses)[number];

export const resultRules = [
  "None",
  "Constant",
  "Natural",
  "Allocation",
  "Declared",
  "Unknown",
  "Cast",
  "Results",
] as const;
export type ResultRuleName = (typeof resultRules)[number];

export const effectRules = ["Declared", "Operator", "Access", "Call", "Builtin", "Inline"] as const;
export type EffectRuleName = (typeof effectRules)[number];

export const heapMarks = ["observable", "ordered", "holdsValues", "perObject", "oneValuePerLocation"] as const;
export type HeapMark = (typeof heapMarks)[number];

export const functionLocalIdKinds: ReadonlySet<string> = new Set(["Value", "Block"]);

export const roleEnumNames: ReadonlyMap<string, string> = new Map([
  ["Function", "FunctionReferenceKind"],
  ["Module", "ModuleReferenceKind"],
]);
export const idKindsWithRoles: ReadonlySet<string> = new Set(roleEnumNames.keys());

export const primitiveWords = ["Undefined", "Null", "False", "True", "Number", "String", "Symbol", "BigInt"] as const;
export type PrimitiveWord = (typeof primitiveWords)[number];

export interface SchemaFile {
  readonly path: string;
  readonly isAbi: boolean;
}

export interface Constant {
  readonly name: string;
  readonly value: bigint;
  readonly location: Location;
}

export type ColumnKind =
  | { readonly tag: "Bool" | "UInt32" | "UInt64" | "Text" | "Name" }
  | { readonly tag: "Enum"; readonly type: SchemaEnum }
  | { readonly tag: "Flags"; readonly type: SchemaEnum };

export type ColumnValue =
  | { readonly tag: "Bool"; readonly value: boolean }
  | { readonly tag: "Integer"; readonly value: bigint }
  | { readonly tag: "Text"; readonly value: string }
  | { readonly tag: "Member"; readonly member: Member }
  | { readonly tag: "Members"; readonly members: readonly Member[] };

export interface EnumColumn {
  readonly name: string;
  readonly kind: ColumnKind;
  readonly isInRust: boolean;
}

export interface Member {
  readonly name: string;
  readonly number: number;
  readonly isEngine: boolean;
  readonly isFromExtension: boolean;
  readonly values: readonly ColumnValue[];
  readonly location: Location;
}

export interface SchemaEnum {
  readonly name: string;
  readonly isFlags: boolean;
  readonly isAbi: boolean;
  readonly isGenerated: boolean;
  readonly columns: readonly EnumColumn[];
  readonly members: readonly Member[];
  readonly wireMemberCount: number;
  readonly file: SchemaFile;
  readonly location: Location;
}

export interface IdKind {
  readonly name: string;
  readonly isEngine: boolean;
  readonly list: ProgramList | null;
  readonly record: SchemaRecord | null;
}

export interface External {
  readonly name: string;
  readonly form: "id" | "enum";
  readonly isEngine: boolean;
  readonly cppType: string;
  readonly rustPath: string | null;
  readonly members: readonly string[];
  readonly below: string | null;
  readonly isNamedInText: boolean;
  readonly location: Location;
}

export type Kind =
  | { readonly tag: "Scalar"; readonly scalar: ScalarKind }
  | { readonly tag: "Id"; readonly id: IdKind; readonly role: Member | null }
  | { readonly tag: "PlacedWord"; readonly word: PlacedWordKind }
  | { readonly tag: "Enum"; readonly type: SchemaEnum }
  | { readonly tag: "Flags"; readonly type: SchemaEnum }
  | { readonly tag: "External"; readonly external: External }
  | { readonly tag: "Record"; readonly record: SchemaRecord }
  | { readonly tag: "Variant"; readonly variant: Variant }
  | { readonly tag: "Span"; readonly element: Kind }
  | { readonly tag: "List"; readonly element: Kind };

export interface Field {
  readonly name: string;
  readonly kind: Kind;
  readonly isOptional: boolean;
  readonly isEngine: boolean;
  readonly arrayLength: number | null;
  readonly isOnePerList: boolean;
  readonly isSorted: boolean;
  readonly sortedBy: Field | null;
  readonly wireWords: number;
  readonly payloadWords: number;
  readonly location: Location;
}

export interface AbiLayout {
  readonly size: number;
  readonly alignment: number;
  readonly offsets: readonly number[];
}

export interface SchemaRecord {
  readonly name: string;
  readonly form: RecordForm;
  readonly isWireOnly: boolean;
  readonly isCustomEngine: boolean;
  readonly isCustomText: boolean;
  readonly isExtendedEngine: boolean;
  readonly fields: readonly Field[];
  readonly wireFields: readonly Field[];
  readonly wireWords: number;
  readonly payloadWords: number;
  readonly abiLayout: AbiLayout | null;
  readonly hasSpans: boolean;
  readonly hasEngineFields: boolean;
  readonly isPayload: boolean;
  readonly file: SchemaFile;
  readonly location: Location;
}

export interface VariantCase {
  readonly name: string;
  readonly number: number;
  readonly fields: readonly Field[];
  readonly location: Location;
}

export interface Variant {
  readonly name: string;
  readonly form: "wire" | "engine";
  readonly cases: readonly VariantCase[];
  readonly wireWords: number;
  readonly payloadWords: number;
  readonly hasSpans: boolean;
  readonly isPayload: boolean;
  readonly file: SchemaFile;
  readonly location: Location;
}

export type SchemaType =
  { readonly tag: "Record"; readonly record: SchemaRecord } | { readonly tag: "Variant"; readonly variant: Variant };

export interface ProgramList {
  readonly name: string;
  readonly number: number;
  readonly element: Kind;
  readonly keyword: string | null;
  readonly prefix: string | null;
  readonly isSorted: boolean;
  readonly sortedBy: Field | null;
  readonly isTable: boolean;
  readonly elementSizeInBytes: number;
  readonly location: Location;
}

export interface Heap {
  readonly name: string;
  readonly number: number;
  readonly indexKinds: readonly Kind[];
  readonly marks: ReadonlySet<HeapMark>;
  readonly location: Location;
}

export interface OpaqueKind {
  readonly name: string;
  readonly number: number;
  readonly isEngine: boolean;
  readonly isFunctionLocal: boolean;
  readonly allowsDirectCallsOnly: boolean;
  readonly isInterior: boolean;
  readonly location: Location;
}

export interface IntegerRange {
  readonly minimum: bigint;
  readonly maximum: bigint;
}

export interface TypeExpression {
  readonly text: string;
  readonly primitives: readonly PrimitiveWord[];
  readonly integers: IntegerRange | null;
  readonly isObject: boolean;
  readonly isFunction: boolean;
  readonly opaque: OpaqueKind | null;
  readonly builtinClass: string | null;
}

export interface NaturalRow {
  readonly classes: readonly OperandClass[];
  readonly type: TypeExpression;
}

export interface NaturalTable {
  readonly name: string;
  readonly number: number;
  readonly arity: number;
  readonly rows: readonly NaturalRow[];
  readonly otherwise: TypeExpression;
  readonly location: Location;
}

export type HeapIndex =
  | { readonly tag: "Payload"; readonly field: PayloadField }
  | { readonly tag: "Member"; readonly type: SchemaEnum; readonly member: Member };

export interface HeapReference {
  readonly heap: Heap;
  readonly indexes: readonly HeapIndex[];
}

export interface Effects {
  readonly isUnknownCode: boolean;
  readonly isAsOverload: boolean;
  readonly readsAllHeaps: boolean;
  readonly writesAllHeaps: boolean;
  readonly reads: readonly HeapReference[];
  readonly writes: readonly HeapReference[];
  readonly throws: boolean;
  readonly collects: boolean;
  readonly suspends: boolean;
  readonly terminates: boolean;
}

export interface NamedEffects {
  readonly name: string;
  readonly number: number;
  readonly effects: Effects;
  readonly location: Location;
}

export interface OperandUses {
  readonly uses: readonly Member[];
  readonly protocols: readonly Member[];
  readonly namedMembers: readonly string[];
  readonly retainedIn: "UnknownMemory" | "Result" | "Operand";
  readonly retainingOperand: number | null;
  readonly assignedFromOperand: number | null;
}

export interface Operand {
  readonly tag: "Operand";
  readonly name: string;
  readonly index: number;
  readonly kind: Member;
  readonly uses: OperandUses;
  readonly isOptional: boolean;
  readonly isVariadic: boolean;
  readonly isEngine: boolean;
  readonly location: Location;
}

export interface PayloadField {
  readonly tag: "Payload";
  readonly name: string;
  readonly kind: Kind;
  readonly payloadKind: Member;
  readonly elementPayloadKind: Member | null;
  readonly isOptional: boolean;
  readonly isEngine: boolean;
  readonly firstForm: Form;
  readonly firstWord: number | null;
  readonly payloadWords: number;
  readonly location: Location;
}

export type Parameter = Operand | PayloadField;

export interface Flag {
  readonly name: string;
  readonly bit: number;
  readonly isEngine: boolean;
  readonly isImplied: boolean;
  readonly location: Location;
}

export type ResultRule =
  | { readonly rule: "None" | "Constant" | "Unknown" }
  | { readonly rule: "Cast"; readonly returned: Operand; readonly type: PayloadField | null }
  | { readonly rule: "Natural"; readonly natural: NaturalResult }
  | { readonly rule: "Allocation"; readonly allocation: AllocationResult }
  | { readonly rule: "Declared"; readonly declared: DeclaredResult }
  | {
      readonly rule: "Results";
      readonly indexEnum: SchemaEnum | null;
      readonly results: readonly Result[];
      readonly isOpen: boolean;
    };

export type NaturalResult =
  | { readonly tag: "Type"; readonly type: TypeExpression }
  | { readonly tag: "Table"; readonly table: NaturalTable }
  | { readonly tag: "SameAs"; readonly operand: Operand };

export type AllocationResult =
  | { readonly tag: "Layout"; readonly layout: PayloadField }
  | { readonly tag: "Class"; readonly builtinClass: string; readonly contents: PayloadField | null }
  | { readonly tag: "BuiltinLayout"; readonly builtinLayout: string };

export type DeclaredResult =
  | { readonly tag: "BlockParameter" }
  | { readonly tag: "Variable" | "Function" | "Layout" | "Module" | "Type" | "Overload"; readonly field: PayloadField }
  | { readonly tag: "Field"; readonly layout: PayloadField; readonly field: PayloadField }
  | { readonly tag: "Key"; readonly key: PayloadField; readonly receiver: Operand }
  | { readonly tag: "Contents"; readonly operand: Operand; readonly slot: Member | null }
  | { readonly tag: "ResultAt"; readonly producer: Operand; readonly index: PayloadField };

export interface Result {
  readonly unproven: ResultRule;
  readonly proven: ResultRule | null;
}

export interface Target {
  readonly name: string;
  readonly index: number;
  readonly isVariadic: boolean;
  readonly takesProofs: boolean;
  readonly results: readonly Result[];
  readonly location: Location;
}

export type EntryColumnKind =
  | { readonly tag: "Bool" | "UInt32" | "Operand" | "Parameters" | "Operations" | "RuntimeOperation" }
  | { readonly tag: "Enum"; readonly type: SchemaEnum }
  | { readonly tag: "EnumSet"; readonly type: SchemaEnum }
  | { readonly tag: "Flags"; readonly type: SchemaEnum };

export interface EntryColumn {
  readonly name: string;
  readonly kind: EntryColumnKind;
  readonly location: Location;
}

export type EntryColumnValue =
  | { readonly tag: "Bool"; readonly value: boolean }
  | { readonly tag: "UInt32"; readonly value: number }
  | { readonly tag: "Operand"; readonly operand: Operand }
  | { readonly tag: "Parameters"; readonly parameters: readonly Parameter[] }
  | { readonly tag: "Operations"; readonly entries: readonly Entry[] }
  | { readonly tag: "RuntimeOperation"; readonly operation: RuntimeOperation }
  | { readonly tag: "Member"; readonly member: Member }
  | { readonly tag: "Members"; readonly members: readonly Member[] };

export interface Entry {
  readonly name: string;
  readonly number: number;
  readonly isTerminator: boolean;
  readonly isWire: boolean;
  readonly family: string;
  readonly firstForm: Form;
  readonly lastForm: Form;
  readonly parameters: readonly Parameter[];
  readonly namedOperands: readonly Operand[];
  readonly variadicOperand: Operand | null;
  readonly payload: readonly PayloadField[];
  readonly flags: readonly Flag[];
  readonly result: Result;
  readonly targets: readonly Target[];
  readonly effects: Effects;
  readonly effectRule: EffectRuleName;
  readonly columns: ReadonlyMap<string, EntryColumnValue>;
  readonly file: SchemaFile;
  readonly location: Location;
}

export interface RuntimeParameter {
  readonly type: string;
  readonly name: string | null;
}

export interface RuntimeOperation {
  readonly name: string;
  readonly number: number;
  readonly resultType: string;
  readonly parameters: readonly RuntimeParameter[];
  readonly effects: Effects;
  readonly isLeaf: boolean;
  readonly preservesMost: boolean;
  readonly file: SchemaFile;
  readonly location: Location;
}

export interface InlineBuiltin {
  readonly name: string;
  readonly number: number;
  readonly parameterKinds: readonly Kind[];
  readonly effects: Effects;
  readonly family: string;
  readonly hasOptionalSlowPath: boolean;
  readonly isFormOnly: boolean;
  readonly location: Location;
}

export interface Schema {
  readonly files: readonly SchemaFile[];
  readonly constants: readonly Constant[];
  readonly enums: readonly SchemaEnum[];
  readonly flagWords: readonly SchemaEnum[];
  readonly generatedEnums: ReadonlyMap<GeneratedEnumName, SchemaEnum>;
  readonly idKinds: readonly IdKind[];
  readonly externals: readonly External[];
  readonly types: readonly SchemaType[];
  readonly lists: readonly ProgramList[];
  readonly heaps: readonly Heap[];
  readonly opaqueKinds: readonly OpaqueKind[];
  readonly naturalTables: readonly NaturalTable[];
  readonly namedEffects: readonly NamedEffects[];
  readonly entryColumns: readonly EntryColumn[];
  readonly families: readonly string[];
  readonly inlineFamilies: readonly string[];
  readonly operations: readonly Entry[];
  readonly terminators: readonly Entry[];
  readonly runtimeOperations: readonly RuntimeOperation[];
  readonly inlineBuiltins: readonly InlineBuiltin[];
}

export function isLegalIn(entry: Entry, form: Form): boolean {
  return forms.indexOf(entry.firstForm) <= forms.indexOf(form) && forms.indexOf(form) <= forms.indexOf(entry.lastForm);
}

export function recordsOf(schema: Schema): SchemaRecord[] {
  return schema.types.flatMap(type => (type.tag === "Record" ? [type.record] : []));
}

export function variantsOf(schema: Schema): Variant[] {
  return schema.types.flatMap(type => (type.tag === "Variant" ? [type.variant] : []));
}

export function entriesOf(schema: Schema): Entry[] {
  return [...schema.operations, ...schema.terminators];
}

export function listPayloadOf(entry: Entry): PayloadField | null {
  return entry.payload.find(field => field.kind.tag === "List") ?? null;
}

export function scalarPayloadWordsOf(entry: Entry): number {
  return entry.payload.reduce((words, field) => words + (field.kind.tag === "List" ? 0 : field.payloadWords), 0);
}

export function wireParametersOf(entry: Entry): Parameter[] {
  return entry.parameters.filter(parameter => !parameter.isEngine);
}

export function wireFlagsOf(entry: Entry): Flag[] {
  return entry.flags.filter(flag => !flag.isEngine);
}

export function wireMembersOf(type: SchemaEnum): readonly Member[] {
  return type.members.slice(0, type.wireMemberCount);
}

export function isIntrinsic(entry: Entry): boolean {
  const value = entry.columns.get("isIntrinsic");
  return value?.tag === "Bool" && value.value;
}

export function mayThrow(effects: Effects): boolean {
  return effects.throws || effects.isUnknownCode;
}

export function innermostKindOf(kind: Kind): Kind {
  return kind.tag === "Span" || kind.tag === "List" ? innermostKindOf(kind.element) : kind;
}

export function wireWordsOf(kind: Kind): number {
  switch (kind.tag) {
    case "Scalar":
      return kind.scalar === "Int64" || kind.scalar === "UInt64" || kind.scalar === "Double" ? 2 : 1;
    case "Id":
    case "PlacedWord":
    case "Enum":
    case "Flags":
    case "External":
      return 1;
    case "Record":
      return kind.record.wireWords;
    case "Variant":
      return kind.variant.wireWords;
    case "Span":
      return 2;
    case "List":
      throw new Error("a List has no fixed number of words");
  }
}

export function payloadWordsOf(kind: Kind): number {
  if (kind.tag === "Record") return kind.record.payloadWords;
  if (kind.tag === "Variant") return kind.variant.payloadWords;
  return kind.tag === "List" ? 0 : wireWordsOf(kind);
}

export function fieldsOf(type: SchemaType): readonly Field[] {
  return type.tag === "Record" ? type.record.fields : type.variant.cases.flatMap(variantCase => variantCase.fields);
}

export function nameOf(type: SchemaType): string {
  return type.tag === "Record" ? type.record.name : type.variant.name;
}

export function isStringKey(key: Field): boolean {
  return key.kind.tag === "Id" && key.kind.id.name === "String";
}

export type NestedKind = Extract<Kind, { tag: "Record" | "Variant" }>;

export function isNested(kind: Kind): kind is NestedKind {
  return kind.tag === "Record" || kind.tag === "Variant";
}

export function isWireType(type: SchemaType): boolean {
  return (type.tag === "Record" ? type.record.form : type.variant.form) === "wire";
}

export function isId(kind: Kind): boolean {
  return kind.tag === "Id" || (kind.tag === "External" && kind.external.form === "id");
}
