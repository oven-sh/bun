import { casePattern } from "./emit-rust-records.ts";
import { blocks, indent, indentation, pack, rustMarker, type CaseBody } from "./lines.ts";
import type { Entry, Field, Kind, Schema, SchemaType, Variant } from "./model.ts";
import { innermostKindOf, isStringKey, nameOf, wireFlagsOf, wireParametersOf, wireWordsOf } from "./model.ts";
import { rustIdentifier, rustTypeName, snakeCase } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";
import { holdsReferences, isReference, listedTypesOf, referenceKind, rustTypeOf, wireFieldsOf } from "./rust-types.ts";

type FieldStatements = (field: Field, value: string, isByReference: boolean) => string[];

function mapField(kind: Kind): string {
  if (kind.tag !== "Id" || kind.id.list === null) throw new Error(`${kind.tag} is not the id of a list`);
  return `map.${snakeCase(kind.id.list.name)}`;
}

function referenceValue(kind: Kind, value: string): string {
  if (kind.tag === "External") return `Reference::${kind.external.name}(${value})`;
  if (kind.tag !== "Id") throw new Error(`${kind.tag} is not a reference`);
  const name = kind.id.name;
  return kind.role === null
    ? `Reference::${name}(${value})`
    : `Reference::${name}(${value}, ${name}ReferenceKind::${kind.role.name})`;
}

function visitField(field: Field, value: string, isByReference: boolean): string[] {
  const kind = field.kind;
  if (!holdsReferences(kind)) return [];
  if (kind.tag === "Span" || kind.tag === "List") {
    const source = isByReference ? value : `&${value}`;
    if (isReference(kind.element)) return [`for &id in ${source} { visit(${referenceValue(kind.element, "id")}); }`];
    return [`for element in ${source} { element.for_each_reference(visit); }`];
  }
  if (kind.tag === "Record" || kind.tag === "Variant") return [`${value}.for_each_reference(visit);`];
  const id = isByReference ? `*${value}` : value;
  if (field.isOptional) return [`if let Some(id) = ${id} { visit(${referenceValue(kind, "id")}); }`];
  return [`visit(${referenceValue(kind, id)});`];
}

function sortStatement(field: Field, value: string): string[] {
  if (!field.isSorted) return [];
  if (field.sortedBy === null) return [`${value}.sort_unstable();`];
  if (field.sortedBy.kind.tag !== "Id" || isStringKey(field.sortedBy)) return [];
  return [`${value}.sort_unstable_by_key(|element| element.${rustIdentifier(field.sortedBy.name)});`];
}

function isCodeWord(kind: Kind): boolean {
  return kind.tag === "Scalar" && kind.scalar === "CodeWord";
}

function isRemapped(kind: Kind, visited: Set<string> = new Set()): boolean {
  const inner = innermostKindOf(kind);
  if (inner.tag === "Id") return isReference(inner);
  if (isCodeWord(inner)) return true;
  if ((inner.tag !== "Record" && inner.tag !== "Variant") || visited.has(nameOf(inner))) return false;
  visited.add(nameOf(inner));
  return wireFieldsOf(inner).some(field => isRemapped(field.kind, visited));
}

function remapField(field: Field, value: string, isByReference: boolean): string[] {
  const kind = field.kind;
  if (!isRemapped(kind)) return [];
  if (kind.tag === "Span" || kind.tag === "List") {
    const element = kind.element;
    if (element.tag === "Id")
      return [`for id in ${value}.iter_mut() { remap(id, ${mapField(element)}); }`, ...sortStatement(field, value)];
    return [`for element in ${value}.iter_mut() { element.remap_ids(map); }`, ...sortStatement(field, value)];
  }
  if (kind.tag === "Record" || kind.tag === "Variant") return [`${value}.remap_ids(map);`];
  const target = isByReference ? value : `&mut ${value}`;
  return [`${field.isOptional ? "remap_optional" : "remap"}(${target}, ${mapField(kind)});`];
}

function matchOnCases(variant: Variant, statementsOf: FieldStatements): string[] {
  const arms = variant.cases.flatMap(variantCase => {
    const statements = variantCase.fields.map(field => statementsOf(field, rustIdentifier(field.name), true));
    const bound = variantCase.fields.filter((_, index) => statements[index].length > 0);
    const pattern = casePattern(variant, variantCase, bound);
    if (bound.length === 0) return [`${pattern} => {}`];
    return [`${pattern} => {`, ...indent(statements.flat()), "}"];
  });
  return ["match self {", ...indent(arms), "}"];
}

function referencesImpl(type: SchemaType): string[] {
  const bodyOf = (statementsOf: FieldStatements): string[] =>
    type.tag === "Record"
      ? type.record.wireFields.flatMap(field => statementsOf(field, `self.${rustIdentifier(field.name)}`, false))
      : matchOnCases(type.variant, statementsOf);
  return [
    `impl ${rustTypeName(nameOf(type))} {`,
    ...indent([
      "pub fn for_each_reference(&self, visit: &mut dyn FnMut(Reference)) {",
      ...indent(bodyOf(visitField)),
      "}",
      "pub fn remap_ids(&mut self, map: &IdMap<'_>) {",
      ...indent(bodyOf(remapField)),
      "}",
    ]),
    "}",
  ];
}

function recordReferencesRs(schema: Schema): string[] {
  const holdsCodeWords = (type: SchemaType): boolean =>
    wireFieldsOf(type).some(field => isCodeWord(innermostKindOf(field.kind)));
  const types = listedTypesOf(schema).filter(type => !holdsCodeWords(type));
  return [
    rustMarker,
    "",
    "use super::enums::{FunctionReferenceKind, ModuleReferenceKind};",
    "use super::records::*;",
    "use crate::ir::references::{IdMap, Reference, remap, remap_optional};",
    "",
    ...blocks(...types.map(referencesImpl)),
  ];
}

const fieldHelpers = `type Visit<'v> = &'v mut dyn FnMut(FieldWord, usize);

fn skip<W: Words + ?Sized>(words: &W, at: &mut usize, count: usize) -> Option<()> {
    if count > 0 {
        words.get(*at + count - 1)?;
    }
    *at += count;
    Some(())
}

fn present<W: Words + ?Sized>(words: &W, at: &mut usize, field: FieldWord, visit: Visit<'_>) -> Option<()> {
    words.get(*at)?;
    visit(field, *at);
    *at += 1;
    Some(())
}

fn optional<W: Words + ?Sized>(words: &W, at: &mut usize, field: FieldWord, visit: Visit<'_>) -> Option<()> {
    if words.get(*at)? != ABSENT_WORD {
        visit(field, *at);
    }
    *at += 1;
    Some(())
}

fn counted<W: Words + ?Sized>(words: &W, at: &mut usize, field: FieldWord, visit: Visit<'_>) -> Option<()> {
    let count = words.get(*at)?;
    *at += 1;
    for _ in 0..count {
        present(words, at, field, visit)?;
    }
    Some(())
}

fn counted_words<W: Words + ?Sized>(words: &W, at: &mut usize, words_per_element: usize) -> Option<()> {
    let count = words.get(*at)? as usize;
    *at += 1;
    skip(words, at, count.checked_mul(words_per_element)?)
}

fn counted_records<W: Words + ?Sized>(
    words: &W,
    at: &mut usize,
    visit: Visit<'_>,
    visit_words: fn(&W, usize, &mut dyn FnMut(FieldWord, usize)) -> Option<usize>,
) -> Option<()> {
    let count = words.get(*at)?;
    *at += 1;
    for _ in 0..count {
        *at = visit_words(words, *at, visit)?;
    }
    Some(())
}`.split("\n");

const operandHelpers = `#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum OperandWord {
    // The index of the operand in the operation's own list of operands.
    Operand(u32),
    Key,
}

type VisitOperand<'v> = &'v mut dyn FnMut(OperandWord, usize);

fn operand<W: Words + ?Sized>(words: &W, at: &mut usize, index: u32, visit: VisitOperand<'_>) -> Option<()> {
    if words.get(*at)? != ABSENT_WORD {
        visit(OperandWord::Operand(index), *at);
    }
    *at += 1;
    Some(())
}

fn operands<W: Words + ?Sized>(words: &W, at: &mut usize, first_index: u32, visit: VisitOperand<'_>) -> Option<()> {
    let count = words.get(*at)?;
    *at += 1;
    for ordinal in 0..count {
        words.get(*at)?;
        visit(OperandWord::Operand(first_index + ordinal), *at);
        *at += 1;
    }
    Some(())
}

fn key<W: Words + ?Sized>(words: &W, at: &mut usize, visit: VisitOperand<'_>) -> Option<()> {
    if words.get(*at)? != ABSENT_WORD {
        visit(OperandWord::Key, *at);
    }
    *at += 1;
    Some(())
}`.split("\n");

function fieldWord(kind: Kind): string {
  return `FieldWord::Reference(${referenceKind(kind)})`;
}

function listStatement(element: Kind): string {
  if (isReference(element)) return `counted(words, &mut at, ${fieldWord(element)}, visit)?;`;
  if (holdsReferences(element)) return `counted_records(words, &mut at, visit, ${rustTypeOf(element)}::visit_words)?;`;
  return `counted_words(words, &mut at, ${wireWordsOf(element)})?;`;
}

function entryStatements(entry: Entry): string[] {
  const statements: string[] = [];
  let skipped = !entry.isTerminator && wireFlagsOf(entry).length > 0 ? 1 : 0;
  const flush = (): void => {
    if (skipped > 0) statements.push(`skip(words, &mut at, ${skipped})?;`);
    skipped = 0;
  };
  const add = (statement: string): void => {
    flush();
    statements.push(statement);
  };
  for (const parameter of wireParametersOf(entry)) {
    if (parameter.tag === "Operand") {
      const helper = parameter.isVariadic ? "counted" : parameter.isOptional ? "optional" : "present";
      add(`${helper}(words, &mut at, FieldWord::Operand, visit)?;`);
      continue;
    }
    const kind = parameter.kind;
    if (kind.tag === "List") add(listStatement(kind.element));
    else if (!holdsReferences(kind)) skipped += wireWordsOf(kind);
    else if (kind.tag === "Record" || kind.tag === "Variant")
      add(`at = ${rustTypeOf(kind)}::visit_words(words, at, visit)?;`);
    else add(`${parameter.isOptional ? "optional" : "present"}(words, &mut at, ${fieldWord(kind)}, visit)?;`);
  }
  flush();
  return statements;
}

function skippedListStatement(element: Kind): string {
  if (isReference(element)) return "counted_words(words, &mut at, 1)?;";
  if (holdsReferences(element))
    return `counted_records(words, &mut at, &mut |_, _| {}, ${rustTypeOf(element)}::visit_words)?;`;
  return `counted_words(words, &mut at, ${wireWordsOf(element)})?;`;
}

function operandStatements(entry: Entry): string[] {
  const statements: string[] = [];
  // Behind the last word that is visited there is nothing to step over.
  let neededCount = 0;
  let skipped = !entry.isTerminator && wireFlagsOf(entry).length > 0 ? 1 : 0;
  const add = (statement: string): void => {
    if (skipped > 0) statements.push(`skip(words, &mut at, ${skipped})?;`);
    skipped = 0;
    statements.push(statement);
  };
  const addVisit = (statement: string): void => {
    add(statement);
    neededCount = statements.length;
  };
  for (const parameter of wireParametersOf(entry)) {
    if (parameter.tag === "Operand") {
      addVisit(`${parameter.isVariadic ? "operands" : "operand"}(words, &mut at, ${parameter.index}, visit)?;`);
      continue;
    }
    const kind = parameter.kind;
    if (kind.tag === "List") add(skippedListStatement(kind.element));
    else if (!holdsReferences(kind)) skipped += wireWordsOf(kind);
    else if (kind.tag === "Record" || kind.tag === "Variant")
      add(`at = ${rustTypeOf(kind)}::visit_words(words, at, &mut |_, _| {})?;`);
    else if (referenceKind(kind) === "ReferenceKind::PropertyKey") addVisit("key(words, &mut at, visit)?;");
    else skipped += 1;
  }
  return statements.slice(0, neededCount);
}

function visitOperandsFunction(name: string, enumName: string, parameter: string, entries: readonly Entry[]): string[] {
  const bodies = entries.map(entry => ({ label: entry.name, body: operandStatements(entry) }));
  return [
    `pub fn ${name}<W: Words + ?Sized>(${parameter}: ${enumName}, words: &W, visit: &mut dyn FnMut(OperandWord, usize)) -> Option<()> {`,
    `${indentation}let mut at = 0;`,
    `${indentation}match ${parameter} {`,
    ...groupedArms(enumName, bodies, indentation.repeat(2)),
    `${indentation}}`,
    `${indentation}Some(())`,
    "}",
  ];
}

export function groupedArms(enumName: string, bodies: readonly CaseBody[], indent: string): string[] {
  const lines: string[] = [];
  for (const members of Map.groupBy(bodies, member => member.body.join("\n")).values()) {
    const labels = pack(
      members.map((member, index) => `${index > 0 ? "| " : ""}${enumName}::${member.label}`),
      indent,
    );
    const body = members[0].body;
    labels[labels.length - 1] += body.length === 0 ? " => {}" : " => {";
    lines.push(...labels);
    if (body.length > 0) lines.push(...body.map(line => indent + indentation + line), `${indent}}`);
  }
  return lines;
}

function visitFunction(name: string, enumName: string, parameter: string, entries: readonly Entry[]): string[] {
  const bodies = entries.map(entry => ({ label: entry.name, body: entryStatements(entry) }));
  return [
    `pub fn ${name}<W: Words + ?Sized>(${parameter}: ${enumName}, words: &W, at: usize, visit: &mut dyn FnMut(FieldWord, usize)) -> Option<usize> {`,
    `${indentation}let mut at = at;`,
    `${indentation}match ${parameter} {`,
    ...groupedArms(enumName, bodies, indentation.repeat(2)),
    `${indentation}}`,
    `${indentation}Some(at)`,
    "}",
  ];
}

function entryFieldsRs(schema: Schema): string[] {
  const isWire = (entry: Entry): boolean => entry.isWire;
  return [
    rustMarker,
    "",
    "use super::entries::{Opcode, TerminatorKind};",
    "use super::enums::{FunctionReferenceKind, ModuleReferenceKind};",
    "use super::records::*;",
    "use crate::ir::body::{FieldWord, Words};",
    "use crate::ir::ids::ABSENT_WORD;",
    "use crate::ir::references::ReferenceKind;",
    "",
    ...fieldHelpers,
    "",
    ...visitFunction("visit_value_fields", "Opcode", "opcode", schema.operations.filter(isWire)),
    "",
    ...visitFunction("visit_terminator_fields", "TerminatorKind", "kind", schema.terminators.filter(isWire)),
    "",
    ...operandHelpers,
    "",
    ...visitOperandsFunction("visit_value_operands", "Opcode", "opcode", schema.operations.filter(isWire)),
    "",
    ...visitOperandsFunction("visit_terminator_operands", "TerminatorKind", "kind", schema.terminators.filter(isWire)),
  ];
}

export function emitRustReferences(context: EmitContext): OutputFile[] {
  return [
    { name: "record_references.rs", lines: recordReferencesRs(context.schema) },
    { name: "entry_fields.rs", lines: entryFieldsRs(context.schema) },
  ];
}
