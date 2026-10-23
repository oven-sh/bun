import type {
  Entry,
  External,
  Field,
  Kind,
  RecordForm,
  ScalarKind,
  Schema,
  SchemaEnum,
  SchemaRecord,
  SchemaType,
} from "./model.ts";
import {
  entriesOf,
  fieldsOf,
  innermostKindOf,
  nameOf,
  scalarKinds,
  scalarPayloadWordsOf,
  wireWordsOf,
} from "./model.ts";
import { cppIdTypeName } from "./names.ts";

export const twoWordScalars: ReadonlySet<ScalarKind> = new Set(
  scalarKinds.filter(scalar => wireWordsOf({ tag: "Scalar", scalar }) === 2),
);

const rawNumberTypes: ReadonlySet<string> = new Set(["uint8_t", "uint32_t", "uint64_t", "double"]);

const engineScalarTypes: Readonly<Record<ScalarKind, string>> = {
  Bool: "bool",
  UInt8: "uint8_t",
  UInt32: "uint32_t",
  UInt64: "uint64_t",
  Int64: "int64_t",
  Double: "double",
  Field: "uint32_t",
  Byte: "uint8_t",
  Word: "uint32_t",
  CodeWord: "uint32_t",
};

const externalMemberNamespaces: Readonly<Record<string, string>> = {
  Builtin: "Builtins",
  BuiltinClass: "BuiltinClasses",
  BuiltinName: "BuiltinNames",
  BuiltinLayout: "BuiltinLayouts",
  BuiltinSlot: "BuiltinSlots",
};

export function underlyingTypeOf(type: SchemaEnum): string {
  const count = type.members.length;
  if (type.isAbi) return "uint32_t";
  if (type.isFlags) return count <= 8 ? "uint8_t" : count <= 16 ? "uint16_t" : "uint32_t";
  return count <= 256 ? "uint8_t" : "uint16_t";
}

export function namespaceOf(type: SchemaEnum): "Wire" | "Typed" {
  return type.isAbi ? "Wire" : "Typed";
}

export function isBorrowedSpan(kind: Kind): boolean {
  if (kind.tag !== "Span" && kind.tag !== "List") return false;
  const element = kind.element;
  return (
    element.tag === "Scalar" &&
    (element.scalar === "Byte" || element.scalar === "Word" || element.scalar === "CodeWord")
  );
}

export function engineRecordNameOf(record: SchemaRecord): string {
  return record.isExtendedEngine ? `${record.name}Record` : record.name;
}

export function engineStructNameOf(type: SchemaType): string {
  return type.tag === "Record" ? engineRecordNameOf(type.record) : type.variant.name;
}

export function engineTypeOf(kind: Kind, isOptional = false): string {
  switch (kind.tag) {
    case "Span":
    case "List":
      if (isBorrowedSpan(kind)) return `std::span<const ${engineTypeOf(kind.element)}>`;
      return `Vector<${engineTypeOf(kind.element)}>`;
    case "Id":
      return cppIdTypeName(kind.id.name);
    case "External":
      if (kind.external.form === "id") return kind.external.cppType;
      return isOptional ? `std::optional<${kind.external.cppType}>` : kind.external.cppType;
    default: {
      const base = requiredEngineTypeOf(kind);
      return isOptional ? `std::optional<${base}>` : base;
    }
  }
}

function requiredEngineTypeOf(kind: Exclude<Kind, { tag: "Span" | "List" | "Id" | "External" }>): string {
  switch (kind.tag) {
    case "Scalar":
      return engineScalarTypes[kind.scalar];
    case "PlacedWord":
      return kind.word;
    case "Enum":
      return kind.type.name;
    case "Flags":
      return `OptionSet<${kind.type.name}>`;
    case "Record":
      return engineRecordNameOf(kind.record);
    case "Variant":
      return kind.variant.name;
  }
}

export function engineInitializerOf(field: Field): string {
  const kind = field.kind;
  if (field.isOptional) return "";
  if (kind.tag === "Scalar") return kind.scalar === "Bool" ? " { false }" : " { 0 }";
  if (kind.tag === "Enum")
    return kind.type.isGenerated ? " { }" : ` { ${kind.type.name}::${kind.type.members[0].name} }`;
  if (kind.tag === "External" && kind.external.form === "enum") return " { }";
  return "";
}

function rawElementTypeOf(kind: Kind, form: RecordForm): string {
  if (form === "abi") {
    if (kind.tag === "Enum" || kind.tag === "Flags") return kind.type.isAbi ? kind.type.name : "uint32_t";
    if (kind.tag === "Record") return kind.record.name;
    if (kind.tag === "Scalar" && kind.scalar === "UInt8") return "uint8_t";
    if (kind.tag === "Scalar" && kind.scalar === "UInt64") return "uint64_t";
    if (kind.tag === "Scalar" && kind.scalar === "Double") return "double";
    return "uint32_t";
  }
  if (kind.tag === "Span") return "Span";
  if (kind.tag === "Record") return kind.record.name;
  if (kind.tag === "Variant") return kind.variant.name;
  if (kind.tag === "Scalar" && kind.scalar === "Int64") return "Int64";
  if (kind.tag === "Scalar" && (kind.scalar === "UInt64" || kind.scalar === "Double")) return "UInt64";
  return "uint32_t";
}

export function rawTypeOf(field: Field, form: RecordForm): string {
  const element = rawElementTypeOf(field.kind, form);
  if (field.isOnePerList) return `std::array<${element}, numberOfLists>`;
  if (field.arrayLength !== null) return `std::array<${element}, ${field.arrayLength}>`;
  return element;
}

export function rawInitializerOf(field: Field, form: RecordForm): string {
  if (field.isOnePerList || field.arrayLength !== null) return " { }";
  if (rawNumberTypes.has(rawTypeOf(field, form))) return field.isOptional ? " { UINT32_MAX }" : " { 0 }";
  if (field.kind.tag === "Enum" || field.kind.tag === "Flags") return " { }";
  return "";
}

export function sectionElementTypeOf(element: Kind): string {
  if (element.tag === "Scalar" && element.scalar === "Byte") return "uint8_t";
  if (element.tag === "Record") return element.record.name;
  if (element.tag === "Variant") return element.variant.name;
  return "uint32_t";
}

export function externalMemberOf(external: External, member: string): string {
  const namespace = externalMemberNamespaces[external.name];
  return namespace === undefined ? `${external.cppType}::${member}` : `${namespace}::${member}`;
}

export function namedExternalMemberOf(schema: Schema, externalName: string, member: string): string {
  const external = schema.externals.find(candidate => candidate.name === externalName);
  if (external === undefined) throw new Error(`${member} is named and the external ${externalName} is not declared`);
  return externalMemberOf(external, member);
}

export function hasEngineStruct(type: SchemaType): boolean {
  if (type.tag === "Variant") return true;
  return type.record.form !== "abi" && !type.record.isWireOnly && !type.record.isCustomEngine;
}

export function engineFieldsOf(record: SchemaRecord): Field[] {
  return record.fields.filter(field => !(field.kind.tag === "Record" && field.kind.record.isCustomEngine));
}

interface TypeDependencies {
  readonly embedded: SchemaType[];
  readonly throughVectors: SchemaType[];
}

function dependenciesOf(type: SchemaType, byName: ReadonlyMap<string, SchemaType>): TypeDependencies {
  const embedded: SchemaType[] = [];
  const throughVectors: SchemaType[] = [];
  for (const field of fieldsOf(type)) {
    const inner = innermostKindOf(field.kind);
    const name = inner.tag === "Record" ? inner.record.name : inner.tag === "Variant" ? inner.variant.name : null;
    const dependency = name === null ? undefined : byName.get(name);
    if (dependency !== undefined) (inner === field.kind ? embedded : throughVectors).push(dependency);
  }
  return { embedded, throughVectors };
}

export function inDependencyOrder(types: readonly SchemaType[]): SchemaType[] {
  const byName = new Map(types.map(type => [nameOf(type), type]));
  const started = new Set<string>();
  const finished = new Set<string>();
  const ordered: SchemaType[] = [];
  const reachesOpenType = (type: SchemaType, seen: Set<string>): boolean => {
    const name = nameOf(type);
    if (seen.has(name)) return false;
    seen.add(name);
    if (started.has(name) && !finished.has(name)) return true;
    const { embedded, throughVectors } = dependenciesOf(type, byName);
    return [...embedded, ...throughVectors].some(dependency => reachesOpenType(dependency, seen));
  };
  const visit = (type: SchemaType): void => {
    const name = nameOf(type);
    if (started.has(name)) return;
    started.add(name);
    const { embedded, throughVectors } = dependenciesOf(type, byName);
    for (const dependency of embedded) visit(dependency);
    for (const dependency of throughVectors) {
      if (!reachesOpenType(dependency, new Set())) visit(dependency);
    }
    ordered.push(type);
    finished.add(name);
  };
  for (const type of types) visit(type);
  return ordered;
}

export function engineTypesInDependencyOrder(schema: Schema): SchemaType[] {
  return inDependencyOrder(schema.types.filter(hasEngineStruct));
}

export function forwardDeclarationsOf(ordered: readonly SchemaType[]): SchemaType[] {
  const positions = new Map(ordered.map((type, index) => [type, index]));
  const byName = new Map(ordered.map(type => [nameOf(type), type]));
  const declared: SchemaType[] = [];
  ordered.forEach((type, index) => {
    for (const dependency of dependenciesOf(type, byName).throughVectors) {
      if ((positions.get(dependency) ?? -1) > index && !declared.includes(dependency)) declared.push(dependency);
    }
  });
  return declared;
}

export function isComparable(type: SchemaType, visited: Set<string> = new Set()): boolean {
  if (visited.has(nameOf(type))) return true;
  visited.add(nameOf(type));
  for (const field of fieldsOf(type)) {
    if (isBorrowedSpan(field.kind)) return false;
    const inner = innermostKindOf(field.kind);
    if (inner.tag === "Record" && !inner.record.isCustomEngine && inner.record.form !== "abi") {
      if (!isComparable({ tag: "Record", record: inner.record }, visited)) return false;
    }
    if (inner.tag === "Variant" && !isComparable({ tag: "Variant", variant: inner.variant }, visited)) return false;
  }
  return true;
}

export function isEmbeddedInEngineRecords(schema: Schema, type: SchemaType): boolean {
  const visited = new Set<string>();
  const embeds = (holder: SchemaType): boolean => {
    if (visited.has(nameOf(holder))) return false;
    visited.add(nameOf(holder));
    return fieldsOf(holder).some(field => {
      const inner = innermostKindOf(field.kind);
      if (inner.tag !== "Record" && inner.tag !== "Variant") return false;
      return nameOf(inner) === nameOf(type) || embeds(inner);
    });
  };
  return schema.types.filter(hasEngineStruct).some(embeds);
}

export function payloadTypesOf(schema: Schema): SchemaType[] {
  const visited = new Set<string>();
  const types: SchemaType[] = [];
  const add = (kind: Kind): void => {
    const inner = kind.tag === "List" ? kind.element : kind;
    if ((inner.tag !== "Record" && inner.tag !== "Variant") || visited.has(nameOf(inner))) return;
    visited.add(nameOf(inner));
    for (const field of fieldsOf(inner)) add(field.kind);
    types.push(inner);
  };
  for (const entry of entriesOf(schema)) {
    for (const field of entry.payload) add(field.kind);
  }
  return types;
}

export function listFirstWord(entry: Entry): string {
  return `std::max<unsigned>(numberOfInlinePayloadWords, ${scalarPayloadWordsOf(entry)})`;
}

export function defaultWordsOf(kind: Kind, isOptional: boolean): string[] {
  switch (kind.tag) {
    case "Record":
      return kind.record.fields.flatMap(field => defaultWordsOf(field.kind, field.isOptional));
    case "Variant":
      return new Array<string>(kind.variant.payloadWords).fill("0");
    case "Id":
      return ["UINT32_MAX"];
    case "External":
      return [isOptional || kind.external.form === "id" ? "UINT32_MAX" : "0"];
    case "Scalar":
      if (twoWordScalars.has(kind.scalar)) return ["0", "0"];
      return [isOptional ? "UINT32_MAX" : "0"];
    case "PlacedWord":
    case "Enum":
    case "Flags":
      return [isOptional ? "UINT32_MAX" : "0"];
    case "Span":
    case "List":
      throw new Error("a list has no fixed number of payload words");
  }
}
