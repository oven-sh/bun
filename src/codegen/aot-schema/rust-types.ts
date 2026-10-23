import type { ColumnKind, Entry, External, Field, Kind, ScalarKind, Schema, SchemaType } from "./model.ts";
import { entriesOf, innermostKindOf, nameOf, wireParametersOf } from "./model.ts";
import { rustIdTypeName, rustTypeName } from "./names.ts";

const scalarTypes: Readonly<Record<ScalarKind, string>> = {
  Bool: "bool",
  UInt8: "u8",
  UInt32: "u32",
  UInt64: "u64",
  Int64: "i64",
  Double: "f64",
  Field: "u32",
  Byte: "u8",
  Word: "u32",
  CodeWord: "u32",
};

export const idsImport = "use crate::ir::ids::*;";

export function rustLiteral(text: string): string {
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function externalTypeName(external: External): string {
  const path = external.rustPath;
  if (path === null) throw new Error(`${external.name} has no Rust path`);
  const separator = path.lastIndexOf("::");
  return separator < 0 ? path : path.slice(separator + 2);
}

export function rustTypeOf(kind: Kind, isOptional = false): string {
  const required = requiredTypeOf(kind);
  return isOptional ? `Option<${required}>` : required;
}

function requiredTypeOf(kind: Kind): string {
  switch (kind.tag) {
    case "Span":
    case "List":
      return `Vec<${rustTypeOf(kind.element)}>`;
    case "Scalar":
      return scalarTypes[kind.scalar];
    case "Id":
      return rustIdTypeName(kind.id.name);
    case "Enum":
    case "Flags":
      return rustTypeName(kind.type.name);
    case "External":
      return externalTypeName(kind.external);
    case "Record":
      return rustTypeName(kind.record.name);
    case "Variant":
      return rustTypeName(kind.variant.name);
    case "PlacedWord":
      throw new Error(`${kind.word} never crosses`);
  }
}

export function rustFieldTypeOf(field: Field): string {
  if (field.isOnePerList) return `[${rustTypeOf(field.kind)}; ProgramList::COUNT]`;
  return rustTypeOf(field.kind, field.isOptional);
}

export function abiFieldTypeOf(field: Field): string {
  const kind = field.kind;
  let element = "u32";
  if ((kind.tag === "Enum" || kind.tag === "Flags") && !field.isOptional) element = rustTypeName(kind.type.name);
  else if (kind.tag === "Record") element = rustTypeName(kind.record.name);
  else if (kind.tag === "Scalar" && kind.scalar === "UInt8") element = "u8";
  else if (kind.tag === "Scalar" && kind.scalar === "UInt64") element = "u64";
  else if (kind.tag === "Scalar" && kind.scalar === "Double") element = "f64";
  return field.arrayLength === null ? element : `[${element}; ${field.arrayLength}]`;
}

export function rustColumnTypeOf(kind: ColumnKind): string {
  switch (kind.tag) {
    case "Bool":
      return "bool";
    case "UInt32":
      return "u32";
    case "UInt64":
      return "u64";
    case "Text":
      return "&'static str";
    case "Name":
      throw new Error("a Name column exists in C++ only");
    case "Enum":
    case "Flags":
      return rustTypeName(kind.type.name);
  }
}

export function wireFieldsOf(type: SchemaType): readonly Field[] {
  return type.tag === "Record" ? type.record.wireFields : type.variant.cases.flatMap(variantCase => variantCase.fields);
}

export function wireTypesOf(schema: Schema): SchemaType[] {
  return schema.types.filter(type => (type.tag === "Record" ? type.record.form : type.variant.form) === "wire");
}

export function listedTypesOf(schema: Schema): SchemaType[] {
  return wireTypesOf(schema).filter(type => !(type.tag === "Record" && type.record.isWireOnly));
}

export function payloadTypesOf(schema: Schema): SchemaType[] {
  const visited = new Set<string>();
  const types: SchemaType[] = [];
  const add = (kind: Kind): void => {
    if (kind.tag === "List") {
      add(kind.element);
      return;
    }
    if ((kind.tag !== "Record" && kind.tag !== "Variant") || visited.has(nameOf(kind))) return;
    visited.add(nameOf(kind));
    for (const field of wireFieldsOf(kind)) add(field.kind);
    types.push(kind);
  };
  for (const entry of entriesOf(schema)) {
    if (!entry.isWire) continue;
    for (const parameter of wireParametersOf(entry)) {
      if (parameter.tag === "Payload") add(parameter.kind);
    }
  }
  return types;
}

function reaches(type: SchemaType, matches: (kind: Kind) => boolean, visited: Set<string> = new Set()): boolean {
  if (visited.has(nameOf(type))) return false;
  visited.add(nameOf(type));
  return wireFieldsOf(type).some(field => {
    const inner = innermostKindOf(field.kind);
    if (matches(inner)) return true;
    return (inner.tag === "Record" || inner.tag === "Variant") && reaches(inner, matches, visited);
  });
}

export function holdsVector(type: SchemaType): boolean {
  return type.tag === "Record" ? type.record.hasSpans : type.variant.hasSpans;
}

export function holdsDouble(type: SchemaType): boolean {
  return reaches(type, kind => kind.tag === "Scalar" && kind.scalar === "Double");
}

export function derivesOf(type: SchemaType): string {
  if (wireFieldsOf(type).some(field => field.isOnePerList)) return "#[derive(Copy, Clone, PartialEq, Debug, Eq, Hash)]";
  const derives = ["Clone", "PartialEq", "Debug", "Default"];
  if (!holdsVector(type)) derives.unshift("Copy");
  if (!holdsDouble(type)) derives.push("Eq", "Hash");
  return `#[derive(${derives.join(", ")})]`;
}

function externalPathsIn(kinds: readonly Kind[]): string[] {
  const paths = new Set<string>();
  for (const kind of kinds) {
    const inner = innermostKindOf(kind);
    if (inner.tag === "External" && inner.external.rustPath !== null) paths.add(inner.external.rustPath);
  }
  return [...paths].sort();
}

export function externalPathsOf(types: readonly SchemaType[]): string[] {
  return externalPathsIn(types.flatMap(type => wireFieldsOf(type).map(field => field.kind)));
}

export function externalPathsOfEntries(entries: readonly Entry[]): string[] {
  const parameters = entries.flatMap(entry => wireParametersOf(entry));
  return externalPathsIn(parameters.flatMap(parameter => (parameter.tag === "Payload" ? [parameter.kind] : [])));
}

export function isWrittenWordByWord(type: SchemaType): boolean {
  if (type.tag === "Variant") return type.variant.isPayload;
  return type.record.isPayload || type.record.isWireOnly || type.record.name === "String";
}

export function isReference(kind: Kind): boolean {
  if (kind.tag === "Id") return kind.id.list !== null;
  return kind.tag === "External" && kind.external.name === "Builtin";
}

function isReferenceOrCode(kind: Kind): boolean {
  return isReference(kind) || (kind.tag === "Scalar" && kind.scalar === "CodeWord");
}

export function holdsReferences(kind: Kind): boolean {
  const inner = innermostKindOf(kind);
  if (isReferenceOrCode(inner)) return true;
  return (inner.tag === "Record" || inner.tag === "Variant") && reaches(inner, isReferenceOrCode);
}

export function referenceKind(kind: Kind): string {
  if (kind.tag === "External") return `ReferenceKind::${kind.external.name}`;
  if (kind.tag !== "Id") throw new Error(`${kind.tag} is not a reference`);
  const name = kind.id.name;
  return kind.role === null
    ? `ReferenceKind::${name}`
    : `ReferenceKind::${name}(${name}ReferenceKind::${kind.role.name})`;
}

export function toWords(kind: Kind, value: string, isOptional = false, isByReference = false): string[] {
  const plain = isByReference ? `*${value}` : value;
  switch (kind.tag) {
    case "Id":
      return [isOptional ? `optional_id_to_word(${plain})` : `${value}.to_word()`];
    case "Scalar":
      return scalarToWords(kind.scalar, value, plain, isOptional);
    case "Flags":
      return [`${value}.0`];
    case "Enum":
    case "External":
      return [isOptional ? `${value}.map_or(ABSENT_WORD, ${rustTypeOf(kind)}::to_wire)` : `${value}.to_wire()`];
    case "PlacedWord":
    case "Record":
    case "Variant":
    case "Span":
    case "List":
      throw new Error(`a ${kind.tag} is not a scalar`);
  }
}

function scalarToWords(scalar: ScalarKind, value: string, plain: string, isOptional: boolean): string[] {
  switch (scalar) {
    case "UInt32":
    case "Field":
      return [isOptional ? `optional_word(${plain})` : plain];
    case "Bool":
      return [`u32::from(${plain})`];
    case "Int64":
    case "UInt64":
      return [`${plain} as u32`, `(${plain} as u64 >> 32) as u32`];
    case "Double":
      return [`${value}.to_bits() as u32`, `(${value}.to_bits() >> 32) as u32`];
    case "UInt8":
    case "Byte":
    case "Word":
    case "CodeWord":
      throw new Error(`${scalar} is not written word by word`);
  }
}

export function fromWords(kind: Kind, isOptional: boolean, words: readonly string[]): string {
  switch (kind.tag) {
    case "Id":
      return `optional_id_from_word::<${rustTypeOf(kind)}>(${words[0]})${isOptional ? "" : "?"}`;
    case "Scalar":
      return scalarFromWords(kind.scalar, isOptional, words);
    case "Enum":
    case "Flags":
    case "External":
      if (isOptional) return `optional_from_word(${words[0]}, ${rustTypeOf(kind)}::from_wire)?`;
      return `${rustTypeOf(kind)}::from_wire(${words[0]})?`;
    case "PlacedWord":
    case "Record":
    case "Variant":
    case "Span":
    case "List":
      throw new Error(`a ${kind.tag} is not a scalar`);
  }
}

function bitsFromWords(words: readonly string[]): string {
  return `${words[0]} as u64 | (${words[1]} as u64) << 32`;
}

function scalarFromWords(scalar: ScalarKind, isOptional: boolean, words: readonly string[]): string {
  switch (scalar) {
    case "UInt32":
    case "Field":
      return isOptional ? `(${words[0]} != ABSENT_WORD).then_some(${words[0]})` : words[0];
    case "Bool":
      return `bool_from_word(${words[0]})?`;
    case "Int64":
      return `(${bitsFromWords(words)}) as i64`;
    case "UInt64":
      return bitsFromWords(words);
    case "Double":
      return `f64::from_bits(${bitsFromWords(words)})`;
    case "UInt8":
    case "Byte":
    case "Word":
    case "CodeWord":
      throw new Error(`${scalar} is not read word by word`);
  }
}
