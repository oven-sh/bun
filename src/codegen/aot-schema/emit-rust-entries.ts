import { denseEnum } from "./emit-rust-enums.ts";
import { blocks, delimited, indentation, pack, rustMarker, withCommas } from "./lines.ts";
import type { Entry, Schema } from "./model.ts";
import { isIntrinsic, wireFlagsOf, wireParametersOf } from "./model.ts";
import { programListMemberName } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";
import { rustLiteral } from "./rust-types.ts";

const twoLevels = indentation.repeat(2);
const threeLevels = indentation.repeat(3);
const fourLevels = indentation.repeat(4);

const entryField = `#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum EntryField {
    Operand { kind: OperandKind, is_optional: bool },
    Payload { kind: PayloadKind, is_optional: bool },
}`.split("\n");

function alternatives(typeName: string, members: readonly string[]): string[] {
  return members.map((member, index) => `${index > 0 ? "| " : ""}${typeName}::${member}`);
}

function predicateFunction(name: string, typeName: string, members: readonly string[]): string[] {
  const head = `${indentation}pub const fn ${name}(self) -> bool {`;
  if (members.length === 0) return [`${head} false }`];
  return [
    head,
    `${twoLevels}matches!(`,
    `${threeLevels}self,`,
    ...pack(alternatives(typeName, members), threeLevels),
    `${twoLevels})`,
    `${indentation}}`,
  ];
}

function simpleFields(entry: Entry): string[] | null {
  if (wireFlagsOf(entry).length > 0) return null;
  const fields: string[] = [];
  for (const parameter of wireParametersOf(entry)) {
    if (parameter.tag === "Operand") {
      if (parameter.isVariadic) return null;
      fields.push(
        `EntryField::Operand { kind: OperandKind::${parameter.kind.name}, is_optional: ${parameter.isOptional} }`,
      );
      continue;
    }
    if (parameter.kind.tag === "List" || parameter.kind.tag === "Record" || parameter.kind.tag === "Variant")
      return null;
    fields.push(
      `EntryField::Payload { kind: PayloadKind::${parameter.payloadKind.name}, is_optional: ${parameter.isOptional} }`,
    );
  }
  return fields;
}

function simpleFieldsFunction(operations: readonly Entry[]): string[] {
  const answers = operations.map(entry => ({ name: entry.name, fields: simpleFields(entry) }));
  const arms: string[] = [];
  for (const group of Map.groupBy(answers, answer =>
    answer.fields === null ? null : answer.fields.join("\n"),
  ).values()) {
    const names = group.map(answer => answer.name);
    const labels = pack(alternatives("Opcode", names), threeLevels);
    const fields = group[0].fields;
    if (fields === null) labels[labels.length - 1] += " => None,";
    else if (fields.length === 0) labels[labels.length - 1] += " => Some(&[]),";
    else labels[labels.length - 1] += " => Some(&[";
    arms.push(...labels);
    if (fields !== null && fields.length > 0)
      arms.push(...fields.map(field => `${fourLevels}${field},`), `${threeLevels}]),`);
  }
  return [
    `${indentation}pub fn simple_fields(self) -> Option<&'static [EntryField]> {`,
    `${twoLevels}match self {`,
    ...arms,
    `${twoLevels}}`,
    `${indentation}}`,
  ];
}

function targetGuard(position: number, variadicPosition: number, declaredCount: number): string {
  const following = declaredCount - position - 1;
  if (position < variadicPosition) return `index == ${position}`;
  if (position > variadicPosition) return `index + ${following + 1} == target_count`;
  return following === 0 ? "index < target_count" : `index + ${following} < target_count`;
}

function targetNameArms(entry: Entry): string[] {
  const pattern = `${threeLevels}TerminatorKind::${entry.name}`;
  const names = entry.targets.map(target => rustLiteral(target.name));
  if (names.length === 0) return [`${pattern} => None,`];
  const variadicPosition = entry.targets.findIndex(target => target.isVariadic);
  if (variadicPosition < 0) return [`${pattern} => [${names.join(", ")}].get(index).copied(),`];
  const arms = names.map(
    (name, position) => `${pattern} if ${targetGuard(position, variadicPosition, names.length)} => Some(${name}),`,
  );
  return [...arms, `${pattern} => None,`];
}

function optionalLiteral(text: string | null): string {
  return text === null ? "None" : `Some(${rustLiteral(text)})`;
}

function namesOf(entries: readonly Entry[]): string[] {
  return entries.map(entry => entry.name);
}

function entriesRs(schema: Schema): string[] {
  const operations = schema.operations.filter(entry => entry.isWire);
  const terminators = schema.terminators.filter(entry => entry.isWire);
  const opaqueKinds = schema.opaqueKinds.filter(kind => !kind.isEngine).map(kind => kind.name);
  const lists = schema.lists;
  const listMembers = lists.map(list => programListMemberName(list.name));
  const elementSizes = lists.map(list => String(list.elementSizeInBytes));
  const keywords = lists.map(list => optionalLiteral(list.keyword));
  const prefixes = lists.map(list => optionalLiteral(list.prefix));
  return [
    rustMarker,
    "",
    "use super::enums::{OperandKind, PayloadKind};",
    "",
    ...blocks(
      denseEnum(schema, "Opcode", namesOf(operations)),
      entryField,
      [
        "impl Opcode {",
        ...predicateFunction(
          "has_result",
          "Opcode",
          namesOf(operations.filter(entry => entry.result.unproven.rule !== "None")),
        ),
        ...predicateFunction(
          "has_flags_word",
          "Opcode",
          namesOf(operations.filter(entry => wireFlagsOf(entry).length > 0)),
        ),
        ...predicateFunction("is_intrinsic", "Opcode", namesOf(operations.filter(isIntrinsic))),
        ...simpleFieldsFunction(operations),
        "}",
      ],
      denseEnum(schema, "TerminatorKind", namesOf(terminators)),
      [
        "impl TerminatorKind {",
        `${indentation}pub fn target_name(self, index: usize, target_count: usize) -> Option<&'static str> {`,
        `${twoLevels}match self {`,
        ...terminators.flatMap(targetNameArms),
        `${twoLevels}}`,
        `${indentation}}`,
        "}",
      ],
      denseEnum(schema, "OpaqueKind", opaqueKinds),
      denseEnum(schema, "ProgramList", listMembers),
      [
        "impl ProgramList {",
        ...delimited(`const ELEMENT_SIZES: [usize; ${lists.length}] = [`, withCommas(elementSizes), "];", indentation),
        ...delimited(
          `const KEYWORDS: [Option<&'static str>; ${lists.length}] = [`,
          withCommas(keywords),
          "];",
          indentation,
        ),
        ...delimited(
          `const PREFIXES: [Option<&'static str>; ${lists.length}] = [`,
          withCommas(prefixes),
          "];",
          indentation,
        ),
        `${indentation}pub const fn element_size(self) -> usize { Self::ELEMENT_SIZES[self as usize] }`,
        `${indentation}pub const fn keyword(self) -> Option<&'static str> { Self::KEYWORDS[self as usize] }`,
        `${indentation}pub const fn prefix(self) -> Option<&'static str> { Self::PREFIXES[self as usize] }`,
        "}",
      ],
    ),
  ];
}

export function emitRustEntries(context: EmitContext): OutputFile[] {
  return [{ name: "entries.rs", lines: entriesRs(context.schema) }];
}
