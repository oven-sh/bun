import { blocks, indent, indentation, rustMarker, type Lines } from "./lines.ts";
import type { Field, Schema, SchemaRecord, Variant, VariantCase } from "./model.ts";
import { wireWordsOf } from "./model.ts";
import { rustIdentifier, rustTypeName } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";
import {
  derivesOf,
  externalPathsOf,
  fromWords,
  holdsReferences,
  idsImport,
  isReference,
  isWrittenWordByWord,
  referenceKind,
  rustFieldTypeOf,
  rustTypeOf,
  toWords,
  wireTypesOf,
} from "./rust-types.ts";

function recordRs(record: SchemaRecord): string[] {
  return [
    derivesOf({ tag: "Record", record }),
    `pub struct ${rustTypeName(record.name)} {`,
    ...record.wireFields.map(field => `${indentation}pub ${rustIdentifier(field.name)}: ${rustFieldTypeOf(field)},`),
    "}",
  ];
}

function variantRs(variant: Variant): string[] {
  const cases = variant.cases.map(variantCase => {
    const attribute = variantCase.number === 0 ? "#[default] " : "";
    if (variantCase.fields.length === 0) return `${indentation}${attribute}${variantCase.name},`;
    const fields = variantCase.fields.map(
      field => `${rustIdentifier(field.name)}: ${rustTypeOf(field.kind, field.isOptional)}`,
    );
    return `${indentation}${attribute}${variantCase.name} { ${fields.join(", ")} },`;
  });
  return [derivesOf({ tag: "Variant", variant }), `pub enum ${rustTypeName(variant.name)} {`, ...cases, "}"];
}

function recordsRs(schema: Schema): string[] {
  const types = wireTypesOf(schema);
  return [
    rustMarker,
    "",
    "use super::entries::{OpaqueKind, ProgramList};",
    "use super::enums::*;",
    "use super::program_enums::*;",
    ...externalPathsOf(types).map(path => `use ${path};`),
    idsImport,
    "",
    ...blocks(...types.map(type => (type.tag === "Record" ? recordRs(type.record) : variantRs(type.variant)))),
  ];
}

function flatFieldWords(fields: readonly Field[]): (readonly [Field, number])[] {
  let word = 0;
  return fields.map(field => {
    const first = word;
    word += field.wireWords;
    return [field, first] as const;
  });
}

function appendExpressions(
  fields: readonly Field[],
  base: string,
  firstWords: Lines = [],
  lastWords: Lines = [],
): string[] {
  const statements: string[] = [];
  let run = [...firstWords];
  const flush = (): void => {
    if (run.length > 0) statements.push(`words.extend([${run.join(", ")}]);`);
    run = [];
  };
  for (const field of fields) {
    const value = `${base}${rustIdentifier(field.name)}`;
    if (field.isOnePerList) {
      flush();
      statements.push(`for element in &${value} { element.append_to(words); }`);
    } else if (field.kind.tag === "Record" || field.kind.tag === "Variant") {
      flush();
      statements.push(`${value}.append_to(words);`);
    } else {
      run.push(...toWords(field.kind, value, field.isOptional, false));
    }
  }
  run.push(...lastWords);
  flush();
  return statements;
}

function readExpression(field: Field, word: number): string {
  if (field.kind.tag === "Record" || field.kind.tag === "Variant")
    return `${rustTypeOf(field.kind)}::from_words(&words[${word}..])?`;
  const words = Array.from({ length: field.wireWords }, (_, index) => `words[${word + index}]`);
  return fromWords(field.kind, field.isOptional, words);
}

function visitStatements(fields: readonly Field[], first: number): string[] {
  const statements: string[] = [];
  for (const [field, word] of flatFieldWords(fields)) {
    const kind = field.kind;
    const position = first + word > 0 ? `at + ${first + word}` : "at";
    if (kind.tag === "Record" || kind.tag === "Variant") {
      if (holdsReferences(kind)) statements.push(`${rustTypeOf(kind)}::visit_words(words, ${position}, visit)?;`);
      continue;
    }
    const isOperand = kind.tag === "Id" && kind.id.name === "Value";
    if (!isOperand && !isReference(kind)) continue;
    const fieldWord = isOperand ? "FieldWord::Operand" : `FieldWord::Reference(${referenceKind(kind)})`;
    if (field.isOptional)
      statements.push(`if words.get(${position})? != ABSENT_WORD { visit(${fieldWord}, ${position}); }`);
    else statements.push(`visit(${fieldWord}, ${position});`);
  }
  return statements;
}

const visitSignature =
  "pub fn visit_words<W: Words + ?Sized>(words: &W, at: usize, visit: &mut dyn FnMut(FieldWord, usize)) -> Option<usize>";

function wordsImpl(name: string, count: number, appends: Lines, reads: Lines, visits: Lines): string[] {
  return [
    `impl ${name} {`,
    ...indent([
      `pub const WORDS: usize = ${count};`,
      "pub fn append_to(&self, words: &mut impl Extend<u32>) {",
      ...indent(appends),
      "}",
      `pub fn from_words(words: &[u32]) -> Option<${name}> {`,
      ...indent([`let words = words.get(..${count})?;`, ...reads]),
      "}",
      `${visitSignature} {`,
      ...indent([`words.get(at + ${count - 1})?;`, ...visits, `Some(at + ${count})`]),
      "}",
    ]),
    "}",
  ];
}

function fieldInitializer(field: Field, word: number): string[] {
  const name = rustIdentifier(field.name);
  if (!field.isOnePerList) return [`${name}: ${readExpression(field, word)},`];
  const element = rustTypeOf(field.kind);
  const size = wireWordsOf(field.kind);
  return [
    `${name}: {`,
    ...indent([
      `let mut elements = [${element}::default(); ProgramList::COUNT];`,
      `for (index, element) in elements.iter_mut().enumerate() { *element = ${element}::from_words(&words[${word} + index * ${size}..])?; }`,
      "elements",
    ]),
    "},",
  ];
}

function recordWordsImpl(record: SchemaRecord): string[] {
  const name = rustTypeName(record.name);
  const initializers = flatFieldWords(record.wireFields).flatMap(([field, word]) => fieldInitializer(field, word));
  return wordsImpl(
    name,
    record.wireWords,
    appendExpressions(record.wireFields, "self."),
    [`Some(${name} {`, ...indent(initializers), "})"],
    visitStatements(record.wireFields, 0),
  );
}

export function casePattern(
  variant: Variant,
  variantCase: VariantCase,
  bound: readonly Field[] = variantCase.fields,
): string {
  const path = `${rustTypeName(variant.name)}::${variantCase.name}`;
  if (variantCase.fields.length === 0) return path;
  const names = bound.map(field => rustIdentifier(field.name));
  if (bound.length < variantCase.fields.length) names.push("..");
  return `${path} { ${names.join(", ")} }`;
}

function variantWordsImpl(variant: Variant): string[] {
  const name = rustTypeName(variant.name);
  const appends: string[] = [];
  const reads: string[] = [];
  const visits: string[] = [];
  for (const variantCase of variant.cases) {
    const { number, fields } = variantCase;
    const usedWords = fields.reduce((words, field) => words + field.wireWords, 1);
    const padding = new Array<string>(variant.wireWords - usedWords).fill("0");
    const statements = appendExpressions(fields, "", [String(number)], padding);
    const body = statements.length === 1 ? statements[0].replace(/;$/, ",") : `{ ${statements.join(" ")} }`;
    appends.push(`${casePattern(variant, variantCase)} => ${body}`);
    const values = flatFieldWords(fields).map(
      ([field, word]) => `${rustIdentifier(field.name)}: ${readExpression(field, 1 + word)}`,
    );
    reads.push(`${number} => ${name}::${variantCase.name}${values.length > 0 ? ` { ${values.join(", ")} }` : ""},`);
    const visited = visitStatements(fields, 1);
    visits.push(visited.length > 0 ? `${number} => { ${visited.join(" ")} }` : `${number} => {}`);
  }
  return wordsImpl(
    name,
    variant.wireWords,
    ["match *self {", ...indent(appends), "}"],
    ["Some(match words[0] {", ...indent([...reads, "_ => return None,"]), "})"],
    ["match words.get(at)? {", ...indent([...visits, "_ => return None,"]), "}"],
  );
}

const wordHelpers = `pub(super) fn bool_from_word(word: u32) -> Option<bool> {
    match word {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    }
}

pub(super) fn optional_from_word<T>(word: u32, from_wire: impl FnOnce(u32) -> Option<T>) -> Option<Option<T>> {
    if word == ABSENT_WORD { Some(None) } else { from_wire(word).map(Some) }
}`.split("\n");

function recordWordsRs(schema: Schema): string[] {
  const types = wireTypesOf(schema).filter(isWrittenWordByWord);
  return [
    rustMarker,
    "",
    "use super::entries::{OpaqueKind, ProgramList};",
    "use super::enums::*;",
    "use super::program_enums::*;",
    "use super::records::*;",
    ...externalPathsOf(types).map(path => `use ${path};`),
    "use crate::ir::body::{FieldWord, Words};",
    idsImport,
    "use crate::ir::references::ReferenceKind;",
    "",
    ...blocks(
      wordHelpers,
      ...types.map(type => (type.tag === "Record" ? recordWordsImpl(type.record) : variantWordsImpl(type.variant))),
    ),
  ];
}

export function emitRustRecords(context: EmitContext): OutputFile[] {
  return [
    { name: "records.rs", lines: recordsRs(context.schema) },
    { name: "record_words.rs", lines: recordWordsRs(context.schema) },
  ];
}
