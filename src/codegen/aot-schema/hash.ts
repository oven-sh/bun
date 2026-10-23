import type {
  ColumnKind,
  ColumnValue,
  Entry,
  External,
  Field,
  Kind,
  Parameter,
  ProgramList,
  Schema,
  SchemaEnum,
  SchemaType,
} from "./model.ts";
import { entriesOf, isIntrinsic, wireFlagsOf, wireMembersOf, wireParametersOf } from "./model.ts";

const offsetBasis = 0xcbf29ce484222325n;
const prime = 0x100000001b3n;

export function kindText(kind: Kind, field?: Field): string {
  if (field?.isOnePerList) return `${kindText(kind)}[lists]`;
  if (field !== undefined && field.arrayLength !== null) return `${kindText(kind)}[${field.arrayLength}]`;
  switch (kind.tag) {
    case "Scalar":
      return kind.scalar;
    case "Id":
      return kind.role === null ? kind.id.name : `${kind.id.name}(${kind.role.name})`;
    case "PlacedWord":
      return kind.word;
    case "Enum":
    case "Flags":
      return kind.type.name;
    case "External":
      return kind.external.name;
    case "Record":
      return kind.record.name;
    case "Variant":
      return kind.variant.name;
    case "Span":
    case "List":
      return `${kind.tag}<${kindText(kind.element)}>`;
  }
}

function columnKindText(kind: ColumnKind): string {
  return kind.tag === "Enum" || kind.tag === "Flags" ? kind.type.name : kind.tag;
}

function columnValueText(value: ColumnValue): string {
  switch (value.tag) {
    case "Bool":
      return String(value.value);
    case "Integer":
      return value.value.toString();
    case "Text":
      return `"${value.value}"`;
    case "Member":
      return value.member.name;
    case "Members":
      return value.members.length === 0 ? "none" : value.members.map(member => member.name).join("+");
  }
}

function orderWords(isSorted: boolean, sortedBy: Field | null): string[] {
  if (!isSorted) return [];
  return sortedBy === null ? ["sorted"] : ["sorted", "by", sortedBy.name];
}

function fieldLine(field: Field): string {
  const kind = `${kindText(field.kind, field)}${field.isOptional ? "?" : ""}`;
  return ["field", field.name, kind, ...orderWords(field.isSorted, field.sortedBy)].join(" ");
}

function enumLines(type: SchemaEnum): string[] {
  if (type.wireMemberCount === 0) return [];
  const hashedColumns = type.columns.flatMap((column, index) => (column.isInRust ? [{ column, index }] : []));
  const head = [
    type.isFlags ? "flags" : "enum",
    type.name,
    ...(type.isAbi ? ["abi"] : []),
    ...hashedColumns.map(({ column }) => `${column.name}:${columnKindText(column.kind)}`),
  ];
  const members = wireMembersOf(type).map(member =>
    ["member", member.name, ...hashedColumns.map(({ index }) => columnValueText(member.values[index]))].join(" "),
  );
  return [head.join(" "), ...members];
}

function typeLines(type: SchemaType): string[] {
  if (type.tag === "Variant") {
    const variant = type.variant;
    if (variant.form === "engine") return [];
    const cases = variant.cases.flatMap(variantCase => [
      `case ${variantCase.name}`,
      ...variantCase.fields.map(fieldLine),
    ]);
    return [`variant ${variant.name} ${variant.form}`, ...cases];
  }
  const record = type.record;
  if (record.form === "engine") return [];
  const marks = [
    ...(record.isCustomEngine ? ["customEngine"] : []),
    ...(record.isCustomText ? ["customText"] : []),
    ...(record.isExtendedEngine ? ["extendedEngine"] : []),
    ...(record.isWireOnly ? ["wireOnly"] : []),
  ];
  return [["record", record.name, record.form, ...marks].join(" "), ...record.wireFields.map(fieldLine)];
}

function externalLines(external: External): string[] {
  if (external.rustPath === null) return [];
  const marks = external.isNamedInText ? ["namedInText"] : [];
  return [["external", external.name, external.form, external.rustPath, ...marks, ...external.members].join(" ")];
}

function listLine(list: ProgramList): string {
  return [
    "list",
    list.name,
    kindText(list.element),
    ...(list.keyword === null ? [] : ["as", list.keyword]),
    ...(list.prefix === null ? [] : ["prefix", list.prefix]),
    ...orderWords(list.isSorted, list.sortedBy),
  ].join(" ");
}

function parameterLine(parameter: Parameter): string {
  const optional = parameter.isOptional ? "?" : "";
  if (parameter.tag === "Payload") return `payload ${parameter.name} ${kindText(parameter.kind)}${optional}`;
  return `operand ${parameter.name} ${parameter.kind.name}${optional}${parameter.isVariadic ? "..." : ""}`;
}

function entryLines(entry: Entry): string[] {
  if (!entry.isWire) return [];
  const head = [entry.isTerminator ? "terminator" : "operation", entry.name, String(entry.number)];
  if (!entry.isTerminator) head.push(entry.result.unproven.rule === "None" ? "noResult" : "result");
  if (isIntrinsic(entry)) head.push("intrinsic");
  return [
    head.join(" "),
    ...wireParametersOf(entry).map(parameterLine),
    ...wireFlagsOf(entry).map(flag => `flag ${flag.name}`),
    ...entry.targets.map(
      target => `target ${target.name}${target.isVariadic ? "..." : ""}${target.takesProofs ? " proof" : ""}`,
    ),
  ];
}

export function hashLines(schema: Schema): string[] {
  return [
    ...schema.constants.map(constant => `constant ${constant.name} ${constant.value}`),
    ...[...schema.enums, ...schema.flagWords].flatMap(enumLines),
    ...schema.opaqueKinds.flatMap(kind => (kind.isEngine ? [] : [`opaque ${kind.name}`])),
    ...schema.externals.flatMap(externalLines),
    ...schema.types.flatMap(typeLines),
    ...schema.lists.map(listLine),
    ...entriesOf(schema).flatMap(entryLines),
  ];
}

export function fnv1a64(lines: readonly string[]): bigint {
  let hash = offsetBasis;
  for (const byte of new TextEncoder().encode(lines.map(line => `${line}\n`).join(""))) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * prime);
  }
  return hash;
}

export function schemaHash(schema: Schema): bigint {
  return fnv1a64(hashLines(schema));
}
