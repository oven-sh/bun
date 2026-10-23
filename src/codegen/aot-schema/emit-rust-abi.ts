import { enumBlock, flagWord } from "./emit-rust-enums.ts";
import { blocks, braced, delimited, indent, rustMarker } from "./lines.ts";
import type { AbiLayout, Schema, SchemaRecord } from "./model.ts";
import { recordsOf } from "./model.ts";
import { rustIdTypeName, rustIdentifier, rustTypeName } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";
import { abiFieldTypeOf, holdsDouble } from "./rust-types.ts";

const bytesPerWord = 4;

const wordReader =
  "fn word_at(bytes: &[u8], offset: usize) -> u32 { u32::from_ne_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]]) }";

interface AbiFile {
  readonly output: string;
  readonly input: string;
  readonly imports: readonly string[];
  readonly holds: "enums" | "records" | "enums and records";
}

const abiFiles: readonly AbiFile[] = [
  {
    output: "limits.rs",
    input: "schema/limits.def",
    imports: ["super::statistics::StatisticId"],
    holds: "enums and records",
  },
  { output: "passes.rs", input: "schema/passes.def", imports: ["super::statistics::StatisticId"], holds: "enums" },
  { output: "statistics.rs", input: "schema/statistics.def", imports: [], holds: "enums and records" },
  {
    output: "diagnostics.rs",
    input: "schema/diagnostics.def",
    imports: ["super::limits::Stage"],
    holds: "enums and records",
  },
  { output: "compile_call_enums.rs", input: "schema/compile-call.def", imports: [], holds: "enums" },
  {
    output: "compile_call.rs",
    input: "schema/compile-call.def",
    holds: "records",
    imports: [
      "super::compile_call_enums::*",
      "super::diagnostics::{InternalErrorKind, UserDiagnosticKind}",
      "super::enums::{IllTypedCause, TypeSiteKind}",
      "super::limits::{LimitId, Stage}",
      "super::passes::PassId",
      "crate::ir::ids::*",
    ],
  },
];

interface CheckedWord {
  readonly offset: number;
  readonly type: string;
}

function abiEnumsOf(schema: Schema, input: string): string[] {
  const own = [...schema.enums, ...schema.flagWords].filter(type => type.isAbi && type.file.path === input);
  return blocks(...own.map(type => (type.isFlags ? flagWord(type) : enumBlock(schema, type))));
}

function abiLayoutOf(record: SchemaRecord): AbiLayout {
  if (record.abiLayout === null) throw new Error(`abi record ${record.name} has no layout`);
  return record.abiLayout;
}

function checkedWords(record: SchemaRecord, base: number): CheckedWord[] {
  const { offsets } = abiLayoutOf(record);
  return record.fields.flatMap((field, index) => {
    const kind = field.kind;
    const elements = Array.from({ length: field.arrayLength ?? 1 }, (_, element) => element);
    if (kind.tag === "Record") {
      const { size } = abiLayoutOf(kind.record);
      return elements.flatMap(element => checkedWords(kind.record, base + offsets[index] + element * size));
    }
    if ((kind.tag !== "Enum" && kind.tag !== "Flags") || field.isOptional) return [];
    return elements.map(element => ({
      offset: base + offsets[index] + element * bytesPerWord,
      type: rustTypeName(kind.type.name),
    }));
  });
}

function idGetters(record: SchemaRecord): string[] {
  return record.fields.flatMap(field => {
    if (field.kind.tag !== "Id" || field.arrayLength !== null) return [];
    const name = rustIdentifier(field.name);
    const type = rustIdTypeName(field.kind.id.name);
    if (field.isOptional)
      return [`pub fn ${name}_id(&self) -> Option<${type}> { optional_id_from_word(self.${name}) }`];
    return [`pub fn ${name}_id(&self) -> ${type} { ${type}::from_word(self.${name}) }`];
  });
}

function abiRecord(record: SchemaRecord): string[] {
  const type = rustTypeName(record.name);
  const layout = abiLayoutOf(record);
  const names = record.fields.map(field => rustIdentifier(field.name));
  const fields = record.fields.map((field, index) => `pub ${names[index]}: ${abiFieldTypeOf(field)}`);
  const conditions = [
    `size_of::<${type}>() == ${layout.size}`,
    `align_of::<${type}>() == ${layout.alignment}`,
    ...names.map((name, index) => `core::mem::offset_of!(${type}, ${name}) == ${layout.offsets[index]}`),
  ];
  const checks = checkedWords(record, 0).map(word => `${word.type}::from_wire(word_at(record, ${word.offset}))?;`);
  const derives = ["Copy", "Clone", "PartialEq", ...(holdsDouble({ tag: "Record", record }) ? [] : ["Eq"]), "Debug"];
  return [
    "#[repr(C)]",
    `#[derive(${derives.join(", ")})]`,
    ...braced(`pub struct ${type}`, fields, "}"),
    ...delimited(
      "const _: () = assert!(",
      conditions.map((condition, index) => (index + 1 < conditions.length ? `${condition} &&` : condition)),
      ");",
    ),
    `impl ${type} {`,
    ...indent(idGetters(record)),
    `    pub fn slice_from_bytes(bytes: &[u8]) -> Option<&[${type}]> {`,
    "        if bytes.is_empty() { return Some(&[]); }",
    "        if !bytes.len().is_multiple_of(size_of::<Self>()) || !bytes.as_ptr().addr().is_multiple_of(align_of::<Self>()) { return None; }",
    ...indent(
      checks.length > 0 ? ["for record in bytes.chunks_exact(size_of::<Self>()) {", ...indent(checks), "}"] : [],
      2,
    ),
    "        // SAFETY: length and alignment were checked, every enum field holds a declared discriminant, and every other field is valid for all bit patterns.",
    "        Some(unsafe { core::slice::from_raw_parts(bytes.as_ptr().cast(), bytes.len() / size_of::<Self>()) })",
    "    }",
    "}",
  ];
}

function abiRs(schema: Schema, file: AbiFile): string[] {
  const declared = recordsOf(schema).filter(record => record.form === "abi" && record.file.path === file.input);
  const records = file.holds === "enums" ? [] : declared;
  const enums = file.holds === "records" ? [] : abiEnumsOf(schema, file.input);
  return [
    rustMarker,
    "",
    ...(file.imports.length > 0 ? [...file.imports.map(path => `use ${path};`), ""] : []),
    ...(records.length > 0 ? [wordReader, ""] : []),
    ...blocks(enums, ...records.map(abiRecord)),
  ];
}

export function emitRustAbi(context: EmitContext): OutputFile[] {
  return abiFiles.map(file => ({ name: file.output, lines: abiRs(context.schema, file) }));
}
