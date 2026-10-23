import { blocks, indent, indentation, rustMarker } from "./lines.ts";
import type { Field, IdKind, ProgramList, Schema, SchemaRecord, SchemaType } from "./model.ts";
import { idKindsWithRoles, isStringKey, nameOf } from "./model.ts";
import { programListMemberName, rustIdentifier, rustTypeName, snakeCase } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";
import { listedTypesOf } from "./rust-types.ts";

const internerTables: ReadonlyMap<string, string | null> = new Map<string, string | null>([
  ["strings", null],
  ["propertyKeys", "program.property_keys.as_slice()"],
  ["types", "program.types.types()"],
  ["signatures", "program.types.signatures()"],
]);

const internerSizes: ReadonlyMap<string, string> = new Map([
  ["strings", "program.strings.len()"],
  ["propertyKeys", "program.property_keys.len()"],
  ["types", "program.types.len()"],
  ["signatures", "program.types.signatures().len()"],
]);

const twoLevels = indentation.repeat(2);
const threeLevels = indentation.repeat(3);

const checkFailure = `#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct CheckFailure {
    pub kind: InternalErrorKind,
    pub list: ProgramList,
    pub record: u32,
}`.split("\n");

const checkReferences =
  `fn check_references<R>(list: ProgramList, records: &[R], sizes: &TableSizes, for_each_reference: fn(&R, &mut dyn FnMut(Reference))) -> Result<(), CheckFailure> {
    for (index, record) in records.iter().enumerate() {
        let mut is_valid = true;
        for_each_reference(record, &mut |reference| is_valid &= sizes.contains(reference));
        if !is_valid {
            return Err(CheckFailure { kind: InternalErrorKind::IdOutOfRange, list, record: index as u32 });
        }
    }
    Ok(())
}`.split("\n");

const checkOrder =
  `fn check_order(list: ProgramList, first_unsorted_record: Option<usize>) -> Result<(), CheckFailure> {
    match first_unsorted_record {
        Some(index) => Err(CheckFailure { kind: InternalErrorKind::UnsortedList, list, record: index as u32 }),
        None => Ok(()),
    }
}`.split("\n");

interface IdList {
  readonly kind: IdKind;
  readonly list: ProgramList;
}

interface Table {
  readonly list: ProgramList;
  readonly type: SchemaType;
}

function idLists(schema: Schema): IdList[] {
  return schema.idKinds.flatMap(kind => (kind.isEngine || kind.list === null ? [] : [{ kind, list: kind.list }]));
}

function tableLists(schema: Schema): Table[] {
  return schema.lists.flatMap(list => {
    const type = list.element;
    return list.isTable && (type.tag === "Record" || type.tag === "Variant") ? [{ list, type }] : [];
  });
}

function tableExpression(list: ProgramList): string | null {
  const internerTable = internerTables.get(list.name);
  return internerTable === undefined ? `&program.${snakeCase(list.name)}` : internerTable;
}

function sizeExpression(list: ProgramList): string {
  return internerSizes.get(list.name) ?? `program.${snakeCase(list.name)}.len()`;
}

function sortKey(sortedBy: Field | null): string {
  return sortedBy === null ? "" : `.${rustIdentifier(sortedBy.name)}`;
}

function sortedSpans(record: SchemaRecord): Field[] {
  return record.wireFields.filter(field => field.kind.tag === "Span" && field.isSorted);
}

function isSortedByText(field: Field): boolean {
  return field.sortedBy !== null && isStringKey(field.sortedBy);
}

function comparesTexts(record: SchemaRecord): boolean {
  return sortedSpans(record).some(isSortedByText);
}

function orderChecks(record: SchemaRecord): string[] {
  return sortedSpans(record).map(field => {
    const key = sortKey(field.sortedBy);
    const ascends = isSortedByText(field)
      ? `order_utf16(strings.get(pair[0]${key}), strings.get(pair[1]${key})).is_lt()`
      : `pair[0]${key} < pair[1]${key}`;
    return `if !self.${rustIdentifier(field.name)}.windows(2).all(|pair| ${ascends}) { return false; }`;
  });
}

function tableChecks(table: Table): string[] {
  const slice = tableExpression(table.list);
  if (slice === null) return [];
  const records = slice.startsWith("&") ? slice.slice(1) : slice;
  const member = `ProgramList::${programListMemberName(table.list.name)}`;
  const checks = [
    `check_references(${member}, ${slice}, &sizes, ${rustTypeName(nameOf(table.type))}::for_each_reference)?;`,
  ];
  if (table.type.tag === "Record" && orderChecks(table.type.record).length > 0) {
    const strings = comparesTexts(table.type.record) ? "&program.strings" : "";
    checks.push(`check_order(${member}, ${records}.iter().position(|record| !record.has_sorted_lists(${strings})))?;`);
  }
  if (table.list.isSorted) {
    const key = sortKey(table.list.sortedBy);
    checks.push(
      `check_order(${member}, ${records}.windows(2).position(|pair| pair[0]${key} >= pair[1]${key}).map(|index| index + 1))?;`,
    );
  }
  return checks;
}

function checksRs(schema: Schema): string[] {
  const kinds = idLists(schema);
  const sortedRecords = listedTypesOf(schema).flatMap(type =>
    type.tag === "Record" && orderChecks(type.record).length > 0 ? [type.record] : [],
  );
  return [
    rustMarker,
    "",
    "use super::diagnostics::InternalErrorKind;",
    "use super::entries::ProgramList;",
    "use super::records::*;",
    "use crate::ir::ids::Id;",
    "use crate::ir::program::Program;",
    "use crate::ir::references::Reference;",
    "use crate::ir::strings::StringTable;",
    "use bun_core::strings::order_utf16;",
    "",
    ...blocks(
      checkFailure,
      ["struct TableSizes {", ...kinds.map(({ list }) => `${indentation}${snakeCase(list.name)}: usize,`), "}"],
      [
        "impl TableSizes {",
        `${indentation}fn contains(&self, reference: Reference) -> bool {`,
        `${twoLevels}match reference {`,
        ...kinds.map(({ kind, list }) => {
          const pattern = idKindsWithRoles.has(kind.name)
            ? `Reference::${kind.name}(id, _)`
            : `Reference::${kind.name}(id)`;
          return `${threeLevels}${pattern} => id.index() < self.${snakeCase(list.name)},`;
        }),
        `${threeLevels}Reference::Builtin(_) => true,`,
        `${twoLevels}}`,
        `${indentation}}`,
        "}",
      ],
      ...sortedRecords.map(record => [
        `impl ${rustTypeName(record.name)} {`,
        `${indentation}fn has_sorted_lists(&self${comparesTexts(record) ? ", strings: &StringTable" : ""}) -> bool {`,
        ...indent(orderChecks(record), 2),
        `${twoLevels}true`,
        `${indentation}}`,
        "}",
      ]),
      checkReferences,
      checkOrder,
      [
        "pub fn check_program(program: &Program) -> Result<(), CheckFailure> {",
        `${indentation}let sizes = TableSizes {`,
        ...kinds.map(({ list }) => `${twoLevels}${snakeCase(list.name)}: ${sizeExpression(list)},`),
        `${indentation}};`,
        ...indent(tableLists(schema).flatMap(tableChecks)),
        `${indentation}Ok(())`,
        "}",
      ],
    ),
  ];
}

export function emitRustChecks(context: EmitContext): OutputFile[] {
  return [{ name: "checks.rs", lines: checksRs(context.schema) }];
}
