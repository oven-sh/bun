import { casePattern } from "./emit-rust-records.ts";
import { kindText } from "./hash.ts";
import { blocks, delimited, indent, indentation, rustMarker, withCommas } from "./lines.ts";
import type {
  Field,
  Kind,
  ProgramList,
  ScalarKind,
  Schema,
  SchemaRecord,
  SchemaType,
  Variant,
  VariantCase,
} from "./model.ts";
import { nameOf, wireWordsOf } from "./model.ts";
import { programListMemberName, rustIdentifier, rustTypeName } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";
import { externalPathsOf, holdsVector, idsImport, listedTypesOf, toWords } from "./rust-types.ts";

const scalarsStoredAsWords: ReadonlySet<ScalarKind> = new Set(["Word", "CodeWord", "UInt32", "Field"]);

interface WriterStatements {
  readonly counts: readonly string[];
  readonly writes: readonly string[];
}

function holdsType(list: ProgramList, type: SchemaType): boolean {
  const element = list.element;
  if (type.tag === "Record") return element.tag === "Record" && element.record === type.record;
  return element.tag === "Variant" && element.variant === type.variant;
}

function listMember(schema: Schema, element: Kind): string {
  if (element.tag === "Scalar" && element.scalar === "Byte") return "Bytes";
  if (element.tag === "Scalar" && element.scalar === "CodeWord") return "Code";
  if (element.tag !== "Record" && element.tag !== "Variant") return "Words";
  const type: SchemaType = element;
  const list = schema.lists.find(candidate => holdsType(candidate, type));
  if (list === undefined) throw new Error(`${nameOf(type)} has no list`);
  return programListMemberName(list.name);
}

function pushesRecords(kind: Kind): boolean {
  return kind.tag === "Span" || ((kind.tag === "Record" || kind.tag === "Variant") && holdsVector(kind));
}

function countField(schema: Schema, field: Field, value: string, byReference: boolean): string[] {
  const kind = field.kind;
  if (kind.tag !== "Span") return pushesRecords(kind) ? [`${value}.count_records(counts);`] : [];
  const count = `counts[ProgramList::${listMember(schema, kind.element)} as usize] += ${value}.len() as u64;`;
  if (!pushesRecords(kind.element)) return [count];
  return [count, `for element in ${byReference ? value : `&${value}`} { element.count_records(counts); }`];
}

function writeSpan(schema: Schema, element: Kind, value: string, byReference: boolean): string[] {
  const source = byReference ? value : `&${value}`;
  if (element.tag === "Scalar" && element.scalar === "Byte") return [`let span = sections.push_bytes(${source});`];
  const push = (words: string) =>
    `let span = sections.push_records(ProgramList::${listMember(schema, element)}, ${words}, ${value}.len());`;
  if (element.tag === "Scalar" && scalarsStoredAsWords.has(element.scalar)) return [push(source)];
  if (element.tag === "Record" || element.tag === "Variant") {
    return [
      `let mut element_words = Vec::with_capacity(${value}.len() * ${wireWordsOf(element)});`,
      `for element in ${source} { element.write_record(sections, &mut element_words); }`,
      push("&element_words"),
    ];
  }
  const words = toWords(element, "element", false, false);
  if (words.length !== 1) throw new Error(`a span of ${kindText(element)} has no list`);
  return [
    `let element_words: Vec<u32> = ${value}.iter().map(|&element| ${words[0]}).collect();`,
    push("&element_words"),
  ];
}

function writeFields(schema: Schema, fields: readonly Field[], base: string, byReference: boolean): string[] {
  const statements: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length === 1) statements.push(`record.push(${run[0]});`);
    else if (run.length > 1) statements.push(...delimited("record.extend([", withCommas(run), "]);"));
    run = [];
  };
  for (const field of fields) {
    const value = `${base}${rustIdentifier(field.name)}`;
    const kind = field.kind;
    if (kind.tag === "Span") {
      flush();
      statements.push(
        "{",
        ...indent([...writeSpan(schema, kind.element, value, byReference), "record.extend([span.first, span.count]);"]),
        "}",
      );
    } else if (kind.tag === "Record" || kind.tag === "Variant") {
      flush();
      statements.push(`${value}.write_record(sections, record);`);
    } else {
      run.push(...toWords(kind, value, field.isOptional, byReference));
    }
  }
  flush();
  return statements;
}

function recordStatements(schema: Schema, record: SchemaRecord): WriterStatements {
  return {
    counts: record.wireFields.flatMap(field => countField(schema, field, `self.${rustIdentifier(field.name)}`, false)),
    writes: writeFields(schema, record.wireFields, "self.", false),
  };
}

function countArm(schema: Schema, variant: Variant, variantCase: VariantCase): string[] {
  const countedFields = variantCase.fields.filter(field => pushesRecords(field.kind));
  const pattern = casePattern(variant, variantCase, countedFields);
  if (countedFields.length === 0) return [`${pattern} => {}`];
  return [
    `${pattern} => {`,
    ...indent(countedFields.flatMap(field => countField(schema, field, rustIdentifier(field.name), true))),
    "}",
  ];
}

function writeArm(schema: Schema, variant: Variant, variantCase: VariantCase): string[] {
  const padding = variant.wireWords - 1 - variantCase.fields.reduce((words, field) => words + field.wireWords, 0);
  return [
    `${casePattern(variant, variantCase)} => {`,
    ...indent([
      `record.push(${variantCase.number});`,
      ...writeFields(schema, variantCase.fields, "", true),
      ...(padding !== 0 ? [`record.extend([0; ${padding}]);`] : []),
    ]),
    "}",
  ];
}

function variantStatements(schema: Schema, variant: Variant): WriterStatements {
  return {
    counts: [
      "match self {",
      ...indent(variant.cases.flatMap(variantCase => countArm(schema, variant, variantCase))),
      "}",
    ],
    writes: [
      "match self {",
      ...indent(variant.cases.flatMap(variantCase => writeArm(schema, variant, variantCase))),
      "}",
    ],
  };
}

function writerImpl(schema: Schema, type: SchemaType): string[] {
  const { counts, writes } =
    type.tag === "Record" ? recordStatements(schema, type.record) : variantStatements(schema, type.variant);
  return [
    `impl ${rustTypeName(nameOf(type))} {`,
    `${indentation}pub fn count_records(&self, counts: &mut ListCounts) {`,
    ...indent(counts, 2),
    `${indentation}}`,
    `${indentation}pub fn write_record<'a>(&'a self, sections: &mut SectionWriter<'a>, record: &mut Vec<u32>) {`,
    ...indent(writes, 2),
    `${indentation}}`,
    "}",
  ];
}

function recordWriterRs(schema: Schema): string[] {
  const types = listedTypesOf(schema);
  return [
    rustMarker,
    "",
    "use super::entries::{OpaqueKind, ProgramList};",
    "use super::enums::*;",
    "use super::program_enums::*;",
    "use super::records::*;",
    ...externalPathsOf(types).map(path => `use ${path};`),
    idsImport,
    "use crate::ir::sections::{ListCounts, SectionWriter};",
    "",
    ...blocks(...types.map(type => writerImpl(schema, type))),
  ];
}

export function emitRustWriter(context: EmitContext): OutputFile[] {
  return [{ name: "record_writer.rs", lines: recordWriterRs(context.schema) }];
}
