import { kindText } from "./hash.ts";
import type {
  External,
  Field,
  Kind,
  Member,
  ProgramList,
  RecordForm,
  ScalarKind,
  Schema,
  SchemaEnum,
  SchemaRecord,
  SchemaType,
  Variant,
} from "./model.ts";
import {
  entriesOf,
  fieldsOf,
  idKindsWithRoles,
  innermostKindOf,
  nameOf,
  recordsOf,
  wireMembersOf,
  wireParametersOf,
} from "./model.ts";
import { compareLocations, type ErrorList, type Location } from "./source.ts";

const maxFlagWordMembers = 32;
const maxHeaps = 32;
const maxRecordFields = 22;
const headerRecordName = "Header";
const abiOnlyScalars: ReadonlySet<ScalarKind> = new Set<ScalarKind>(["UInt8", "UInt64"]);
const spanOnlyScalars: ReadonlySet<ScalarKind> = new Set<ScalarKind>(["Byte", "Word", "CodeWord"]);
const optionalScalars: ReadonlySet<ScalarKind> = new Set<ScalarKind>(["UInt32", "Field"]);

const listNamesOfScalars: Readonly<Record<ScalarKind, string | null>> = {
  Bool: "words",
  UInt8: null,
  UInt32: "words",
  UInt64: null,
  Int64: null,
  Double: null,
  Field: "words",
  Byte: "bytes",
  Word: "words",
  CodeWord: "code",
};

interface SortedElements {
  readonly isSorted: boolean;
  readonly sortedBy: Field | null;
  readonly location: Location;
}

function formOf(type: SchemaType): RecordForm {
  return type.tag === "Record" ? type.record.form : type.variant.form;
}

function locationOf(type: SchemaType): Location {
  return type.tag === "Record" ? type.record.location : type.variant.location;
}

function describe(type: SchemaType): string {
  return `${formOf(type)} ${type.tag === "Record" ? "record" : "variant"} ${nameOf(type)}`;
}

function describeField(type: SchemaType, field: Field): string {
  return `field ${field.name} of ${nameOf(type)}`;
}

function crossesWire(type: SchemaType, field: Field): boolean {
  return formOf(type) === "wire" && !field.isEngine;
}

function recordOrVariantOf(kind: Kind): SchemaRecord | Variant | null {
  if (kind.tag === "Record") return kind.record;
  return kind.tag === "Variant" ? kind.variant : null;
}

function forEachField(schema: Schema, visit: (type: SchemaType, field: Field) => void): void {
  for (const type of schema.types) {
    for (const field of fieldsOf(type)) visit(type, field);
  }
}

export function engineKindNameOf(kind: Kind): string | null {
  switch (kind.tag) {
    case "Scalar":
      return null;
    case "Id":
      return kind.id.isEngine ? kind.id.name : null;
    case "PlacedWord":
      return kind.word;
    case "Enum":
    case "Flags":
      return kind.type.wireMemberCount === 0 ? kind.type.name : null;
    case "External":
      return kind.external.isEngine ? kind.external.name : null;
    case "Record":
      return kind.record.form === "engine" ? kind.record.name : null;
    case "Variant":
      return kind.variant.form === "engine" ? kind.variant.name : null;
    case "Span":
    case "List":
      return engineKindNameOf(kind.element);
  }
}

function checkColumnValues(type: SchemaEnum, errors: ErrorList): void {
  for (const member of wireMembersOf(type)) {
    type.columns.forEach((column, index) => {
      const value = member.values[index];
      if (!column.isInRust || value === undefined) return;
      const named: readonly Member[] =
        value.tag === "Member" ? [value.member] : value.tag === "Members" ? value.members : [];
      for (const { name } of named.filter(other => other.isEngine)) {
        errors.add(member.location, `wire member ${member.name} of ${type.name} uses the engine-only member ${name}`);
      }
    });
  }
}

function checkUniqueNames(declared: readonly (Member | Field)[], owner: string, errors: ErrorList): void {
  const names = new Set<string>();
  for (const { name, location } of declared) {
    if (names.has(name)) errors.add(location, `${name} is declared twice in ${owner}`);
    names.add(name);
  }
}

function checkEnums(schema: Schema, errors: ErrorList): void {
  for (const type of [...schema.enums, ...schema.flagWords]) {
    const description = `${type.isFlags ? "flag word" : "enum"} ${type.name}`;
    if (type.members.length === 0) errors.add(type.location, `${description} has no members`);
    checkUniqueNames(type.members, type.name, errors);
    if (type.isFlags && type.members.length > maxFlagWordMembers) {
      errors.add(type.location, `${description} has more than ${maxFlagWordMembers} members`);
    }
    if (type.isAbi && type.members.length > type.wireMemberCount) {
      errors.add(type.location, `abi type ${type.name} has engine members`);
    }
    checkColumnValues(type, errors);
  }
}

function checkOpaqueKinds(schema: Schema, errors: ErrorList): void {
  const compare = compareLocations(schema.files);
  const engineKinds = schema.opaqueKinds.filter(kind => kind.isEngine);
  for (const kind of schema.opaqueKinds) {
    const { name, location } = kind;
    if (!kind.isEngine && engineKinds.some(engineKind => compare(engineKind.location, location) < 0)) {
      errors.add(location, `wire opaque kind ${name} follows an engine kind`);
    }
    if (kind.isInterior && !kind.isEngine) errors.add(location, `interior kind ${name} is not marked engine`);
    if (kind.isInterior && !kind.isFunctionLocal) {
      errors.add(location, `interior kind ${name} is not marked functionLocal`);
    }
    if (kind.isFunctionLocal && kind.allowsDirectCallsOnly) {
      errors.add(location, `${name} is functionLocal and directCallsOnly`);
    }
  }
}

function externalsOnWire(schema: Schema): Set<External> {
  const kinds: Kind[] = [];
  forEachField(schema, (type, field) => {
    if (formOf(type) !== "engine" && !field.isEngine) kinds.push(field.kind);
  });
  for (const entry of entriesOf(schema)) {
    if (!entry.isWire) continue;
    for (const parameter of wireParametersOf(entry)) {
      if (parameter.tag === "Payload") kinds.push(parameter.kind);
    }
  }
  const externals = new Set<External>();
  for (const kind of kinds) {
    const inner = innermostKindOf(kind);
    if (inner.tag === "External") externals.add(inner.external);
  }
  return externals;
}

function checkExternals(schema: Schema, errors: ErrorList): void {
  const onWire = externalsOnWire(schema);
  for (const external of schema.externals) {
    if (external.isEngine || external.rustPath !== null || !onWire.has(external)) continue;
    errors.add(external.location, `external ${external.name} crosses the wire and has no Rust path`);
  }
}

function checkHeaps(schema: Schema, errors: ErrorList): void {
  if (schema.heaps.length > maxHeaps) errors.add(schema.heaps[maxHeaps].location, `more than ${maxHeaps} heaps`);
}

function checkRecordShape(type: SchemaType, errors: ErrorList): void {
  if (type.tag === "Record") {
    const { record } = type;
    if (record.fields.length > maxRecordFields) {
      errors.add(record.location, `record ${record.name} has more than ${maxRecordFields} fields`);
    }
    checkUniqueNames(record.fields, record.name, errors);
    return;
  }
  const { variant } = type;
  if (variant.cases.length === 0) errors.add(variant.location, `variant ${variant.name} has no cases`);
  const names = new Set<string>();
  for (const variantCase of variant.cases) {
    const description = `case ${variantCase.name} of ${variant.name}`;
    if (names.has(variantCase.name)) errors.add(variantCase.location, `${description} is declared twice`);
    names.add(variantCase.name);
    if (variantCase.number === 0 && variantCase.fields.length > 0) {
      errors.add(variantCase.location, `${description} is the zero case and has fields`);
    }
    if (variantCase.fields.some(field => field.isEngine))
      errors.add(variantCase.location, `${description} has engine fields`);
    checkUniqueNames(variantCase.fields, description, errors);
  }
}

function checkWireFieldKind(type: SchemaType, field: Field, errors: ErrorList): void {
  const inner = innermostKindOf(field.kind);
  const engineKind = engineKindNameOf(inner);
  if (engineKind !== null) errors.add(locationOf(type), `${describe(type)} names the engine kind ${engineKind}`);
  if (inner.tag === "Id" && inner.role?.isEngine) {
    errors.add(locationOf(type), `${describe(type)} uses the engine-only member ${inner.role.name}`);
  }
  if (inner.tag === "Scalar" && abiOnlyScalars.has(inner.scalar)) {
    const isInHeader = inner.scalar === "UInt64" && nameOf(type) === headerRecordName;
    if (!isInHeader) errors.add(field.location, `${inner.scalar} is only allowed in an abi record`);
  }
  if (field.kind.tag === "List") errors.add(field.location, "List is only allowed in a payload");
}

function isAbiKind(kind: Kind): boolean {
  switch (kind.tag) {
    case "Scalar":
      return kind.scalar !== "Int64";
    case "Record":
      return kind.record.form === "abi";
    case "Id":
    case "PlacedWord":
    case "Enum":
    case "Flags":
    case "External":
      return true;
    case "Variant":
    case "Span":
    case "List":
      return false;
  }
}

function checkAbiFieldKind(type: SchemaType, field: Field, errors: ErrorList): void {
  const engineKind = engineKindNameOf(field.kind);
  if (engineKind !== null) {
    errors.add(locationOf(type), `${describe(type)} names the engine kind ${engineKind}`);
  } else if (!isAbiKind(field.kind)) {
    errors.add(field.location, `${kindText(field.kind)} is not allowed in an abi record`);
  }
}

function checkFieldKinds(type: SchemaType, field: Field, errors: ErrorList): void {
  const { kind, location } = field;
  const isAbi = formOf(type) === "abi";
  if (isAbi) checkAbiFieldKind(type, field, errors);
  else if (crossesWire(type, field)) checkWireFieldKind(type, field, errors);
  if (kind.tag === "Scalar" && spanOnlyScalars.has(kind.scalar)) {
    errors.add(location, `${kind.scalar} is only allowed in a Span or a list`);
  }
  if (!isAbi && field.arrayLength !== null && !field.isOnePerList) {
    errors.add(location, `${describeField(type, field)}: only an abi record has arrays`);
  }
  if (field.isOnePerList && nameOf(type) !== headerRecordName) {
    errors.add(location, `${describeField(type, field)}: only ${headerRecordName} has one element per list`);
  }
}

export function canBeOptional(kind: Kind): boolean {
  switch (kind.tag) {
    case "Scalar":
      return optionalScalars.has(kind.scalar);
    case "Id":
    case "PlacedWord":
    case "Enum":
    case "External":
      return true;
    case "Flags":
    case "Record":
    case "Variant":
    case "Span":
    case "List":
      return false;
  }
}

function checkOptionalFields(schema: Schema, errors: ErrorList): void {
  forEachField(schema, (type, field) => {
    if (!field.isOptional || canBeOptional(field.kind)) return;
    errors.add(field.location, `${describeField(type, field)}: ${kindText(field.kind)} cannot be optional`);
  });
}

function scalarListNameOf(element: Kind): string | null {
  switch (element.tag) {
    case "Scalar":
      return listNamesOfScalars[element.scalar];
    case "Id":
    case "PlacedWord":
    case "Enum":
    case "Flags":
    case "External":
      return "words";
    case "Record":
    case "Variant":
    case "Span":
    case "List":
      return null;
  }
}

function checkSpans(schema: Schema, errors: ErrorList): void {
  const listNames = new Set(schema.lists.map(list => list.name));
  const listedTypes = new Set(schema.lists.map(list => recordOrVariantOf(list.element)));
  const reported = new Set<SchemaRecord | Variant>();
  forEachField(schema, (type, field) => {
    if (!crossesWire(type, field) || field.kind.tag !== "Span") return;
    const { element } = field.kind;
    const elementType = recordOrVariantOf(element);
    if (elementType !== null) {
      if (listedTypes.has(elementType) || reported.has(elementType)) return;
      reported.add(elementType);
      const word = element.tag === "Record" ? "record" : "variant";
      errors.add(elementType.location, `${word} ${elementType.name} has no list`);
      return;
    }
    const listName = scalarListNameOf(element);
    if (listName === null) {
      errors.add(field.location, `${describeField(type, field)}: a Span cannot hold ${kindText(element)}`);
    } else if (!listNames.has(listName)) {
      errors.add(field.location, `${describeField(type, field)} needs the list ${listName}`);
    }
  });
}

function checkSortKey(
  sorted: SortedElements,
  element: Kind,
  subject: string,
  container: "list" | "span",
  errors: ErrorList,
): void {
  if (!sorted.isSorted) return;
  const key = sorted.sortedBy;
  if (key === null) {
    if (recordOrVariantOf(element) === null) return;
    errors.add(sorted.location, `${subject}: a sorted ${container} of records needs a sort key`);
  } else if (key.isEngine || key.wireWords !== 1) {
    errors.add(sorted.location, `${subject} is sorted by ${key.name}, which is not one word on the wire`);
  }
}

function checkSortedFields(schema: Schema, errors: ErrorList): void {
  for (const list of schema.lists) checkSortKey(list, list.element, `list ${list.name}`, "list", errors);
  forEachField(schema, (type, field) => {
    if (field.kind.tag === "Span") checkSortKey(field, field.kind.element, describeField(type, field), "span", errors);
  });
}

function checkRoles(schema: Schema, errors: ErrorList): void {
  forEachField(schema, (type, field) => {
    if (formOf(type) !== "wire") return;
    const inner = innermostKindOf(field.kind);
    if (inner.tag !== "Id" || inner.role !== null || !idKindsWithRoles.has(inner.id.name)) return;
    errors.add(field.location, `${describeField(type, field)}: a ${inner.id.name} needs a role`);
  });
}

function abiSizeOf(field: Field): number {
  const { kind } = field;
  let size = 4;
  if (kind.tag === "Scalar" && kind.scalar === "UInt8") size = 1;
  else if (kind.tag === "Scalar" && (kind.scalar === "UInt64" || kind.scalar === "Double")) size = 8;
  else if (kind.tag === "Record" && kind.record.abiLayout !== null) size = kind.record.abiLayout.size;
  return size * (field.arrayLength ?? 1);
}

function checkAbiLayout(record: SchemaRecord, errors: ErrorList): void {
  const layout = record.abiLayout;
  if (layout === null) return;
  let end = 0;
  record.fields.forEach((field, index) => {
    const offset = layout.offsets[index];
    if (offset > end) {
      errors.add(record.location, `record ${record.name} has ${offset - end} bytes of padding before ${field.name}`);
    }
    end = offset + abiSizeOf(field);
  });
  if (layout.size > end) {
    errors.add(record.location, `record ${record.name} has ${layout.size - end} bytes of padding at its end`);
  }
}

function isListElement(element: Kind): boolean {
  if (element.tag === "Scalar") return spanOnlyScalars.has(element.scalar);
  return recordOrVariantOf(element)?.form === "wire";
}

function checkUniqueWord(
  list: ProgramList,
  word: string | null,
  description: "prefix" | "keyword",
  taken: Map<string, ProgramList>,
  errors: ErrorList,
): void {
  if (word === null) return;
  const first = taken.get(word);
  if (first === undefined) taken.set(word, list);
  else errors.add(list.location, `list ${list.name} has the ${description} ${word} of list ${first.name}`);
}

function checkLists(schema: Schema, errors: ErrorList): void {
  const listedTypes = new Set<SchemaRecord | Variant>();
  const prefixes = new Map<string, ProgramList>();
  const keywords = new Map<string, ProgramList>();
  for (const list of schema.lists) {
    const { element, location, name, prefix } = list;
    if (!isListElement(element)) {
      errors.add(location, `list ${name}: ${kindText(element)} is neither a wire type nor Byte, Word or CodeWord`);
    }
    const elementType = recordOrVariantOf(element);
    if (elementType !== null) {
      if (listedTypes.has(elementType)) errors.add(elementType.location, `${elementType.name} has two lists`);
      listedTypes.add(elementType);
    }
    if (prefix !== null && !/^[A-Za-z]$/.test(prefix)) {
      errors.add(location, `list ${name}: the prefix ${prefix} is not one letter`);
    }
    checkUniqueWord(list, prefix, "prefix", prefixes, errors);
    checkUniqueWord(list, list.keyword, "keyword", keywords, errors);
  }
}

export function checkTypes(schema: Schema, errors: ErrorList): void {
  checkEnums(schema, errors);
  checkOpaqueKinds(schema, errors);
  checkExternals(schema, errors);
  checkHeaps(schema, errors);
  for (const type of schema.types) checkRecordShape(type, errors);
  forEachField(schema, (type, field) => checkFieldKinds(type, field, errors));
  checkOptionalFields(schema, errors);
  checkSpans(schema, errors);
  checkSortedFields(schema, errors);
  checkRoles(schema, errors);
  for (const record of recordsOf(schema)) checkAbiLayout(record, errors);
  checkLists(schema, errors);
}
