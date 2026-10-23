import type {
  AbiLayout,
  ColumnKind,
  ColumnValue,
  EnumColumn,
  External,
  Field,
  Kind,
  Member,
  OpaqueKind,
  ProgramList,
  SchemaEnum,
  SchemaFile,
  SchemaRecord,
  SchemaType,
  Variant,
} from "./model.ts";
import {
  fieldsOf,
  functionLocalIdKinds,
  generatedEnumNames,
  innermostKindOf,
  nameOf,
  placedWordKinds,
  recordForms,
  roleEnumNames,
  scalarKinds,
  wireParametersOf,
  wireWordsOf,
} from "./model.ts";
import type { DeclarationInFile } from "./parse.ts";
import type { Mutable, MutableEnum, MutableRecord, MutableVariant, Scope } from "./resolve.ts";
import type { Location } from "./source.ts";
import type {
  EnumSyntax,
  ExtendSyntax,
  ExternalSyntax,
  FieldSyntax,
  KindSyntax,
  ListSyntax,
  MemberSyntax,
  Name,
  OpaqueSyntax,
  ParsedFile,
  RecordSyntax,
  ValueSyntax,
  VariantSyntax,
} from "./syntax.ts";

export type KindPosition = "field" | "span" | "list" | "payload";

interface SortedField {
  readonly field: Mutable<Field>;
  readonly syntax: FieldSyntax;
  readonly key: Name;
  readonly owner: string;
}

interface Sizes {
  readonly wireWords: number;
  readonly payloadWords: number;
}

interface SizeComputation {
  readonly scope: Scope;
  readonly active: Set<SchemaRecord | Variant>;
  readonly finished: Set<SchemaRecord | Variant>;
}

const recordMarks = ["wireOnly", "customEngine", "customText", "extendedEngine"] as const;
const variantForms = ["wire", "engine"] as const;
const externalForms = ["id", "enum"] as const;
const scalarColumnKinds = ["Bool", "UInt32", "UInt64", "Text", "Name"] as const;
const maximumColumnIntegers = { UInt32: 0xffffffffn, UInt64: 0xffffffffffffffffn } as const;
const placeholderKind: Kind = { tag: "Scalar", scalar: "UInt32" };

function findDeclared<Value extends { readonly location: Location }>(
  table: ReadonlyMap<string, Value>,
  name: Name,
): Value | null {
  const value = table.get(name.text);
  return value !== undefined && value.location === name.location ? value : null;
}

function otherTypeTables(scope: Scope, table: ReadonlyMap<string, unknown>): ReadonlyMap<string, unknown>[] {
  const tables: ReadonlyMap<string, unknown>[] = [
    scope.enums,
    scope.externals,
    scope.opaqueKinds,
    scope.records,
    scope.variants,
  ];
  return tables.filter(other => other !== table);
}

function sumOf(fields: readonly Field[], wordsOf: (field: Field) => number): number {
  return fields.reduce((words, field) => words + wordsOf(field), 0);
}

function roundUp(offset: number, alignment: number): number {
  return Math.ceil(offset / alignment) * alignment;
}

function createEnum(name: string, file: SchemaFile, location: Location): MutableEnum {
  return {
    name,
    isFlags: false,
    isAbi: false,
    isGenerated: false,
    columns: [],
    members: [],
    wireMemberCount: 0,
    file,
    location,
  };
}

function declareGeneratedEnums(scope: Scope): void {
  const file = scope.files[0];
  const location: Location = { path: file.path, line: 1, column: 1 };
  for (const name of generatedEnumNames)
    scope.enums.set(name, { ...createEnum(name, file, location), isGenerated: true });
}

function appendMember(type: MutableEnum, name: string, isEngine: boolean, location: Location): Mutable<Member> {
  const member: Mutable<Member> = {
    name,
    number: type.members.length,
    isEngine,
    isFromExtension: false,
    values: [],
    location,
  };
  type.members.push(member);
  if (!isEngine) type.wireMemberCount += 1;
  return member;
}

function declareEnum(scope: Scope, syntax: EnumSyntax, file: ParsedFile): void {
  const type: MutableEnum = {
    ...createEnum(syntax.name.text, file, syntax.name.location),
    isFlags: syntax.declares === "flags",
    isAbi: syntax.isAbi || file.isAbi,
  };
  for (const member of syntax.members) appendMember(type, member.name.text, member.isEngine, member.name.location);
  scope.declare(scope.enums, syntax.name, type, otherTypeTables(scope, scope.enums));
}

function declareExternal(scope: Scope, syntax: ExternalSyntax): void {
  const form = externalForms.find(candidate => candidate === syntax.form.text);
  if (form === undefined) scope.errors.add(syntax.form.location, `unknown external form ${syntax.form.text}`);
  const external: External = {
    name: syntax.name.text,
    form: form ?? "id",
    isEngine: syntax.isEngine,
    cppType: syntax.cppType,
    rustPath: syntax.rustPath,
    members: syntax.members.map(member => member.text),
    below: syntax.below,
    isNamedInText: syntax.isNamedInText,
    location: syntax.name.location,
  };
  scope.declare(scope.externals, syntax.name, external, otherTypeTables(scope, scope.externals));
}

function declareOpaqueKinds(scope: Scope, syntax: OpaqueSyntax): void {
  const marks = new Set(syntax.marks.map(mark => mark.text));
  for (const name of syntax.names) {
    const kind: OpaqueKind = {
      name: name.text,
      number: scope.opaqueKinds.size,
      isEngine: marks.has("engine"),
      isFunctionLocal: marks.has("functionLocal"),
      allowsDirectCallsOnly: marks.has("directCallsOnly"),
      isInterior: marks.has("interior"),
      location: name.location,
    };
    scope.declare(scope.opaqueKinds, name, kind, otherTypeTables(scope, scope.opaqueKinds));
  }
}

function declareRecord(scope: Scope, syntax: RecordSyntax, file: ParsedFile): void {
  const form = recordForms.find(candidate => candidate === syntax.form.text);
  if (form === undefined) scope.errors.add(syntax.form.location, `unknown record form ${syntax.form.text}`);
  for (const mark of syntax.marks) {
    if (recordMarks.some(candidate => candidate === mark.text)) continue;
    scope.errors.add(mark.location, `unknown mark ${mark.text} of record ${syntax.name.text}`);
  }
  const hasMark = (mark: (typeof recordMarks)[number]) => syntax.marks.some(written => written.text === mark);
  const record: MutableRecord = {
    name: syntax.name.text,
    form: form ?? "engine",
    isWireOnly: hasMark("wireOnly"),
    isCustomEngine: hasMark("customEngine"),
    isCustomText: hasMark("customText"),
    isExtendedEngine: hasMark("extendedEngine"),
    fields: [],
    wireFields: [],
    wireWords: 0,
    payloadWords: 0,
    abiLayout: null,
    hasSpans: false,
    hasEngineFields: false,
    isPayload: false,
    file,
    location: syntax.name.location,
  };
  scope.declare(scope.records, syntax.name, record, otherTypeTables(scope, scope.records));
}

function declareVariant(scope: Scope, syntax: VariantSyntax, file: ParsedFile): void {
  const form = variantForms.find(candidate => candidate === syntax.form.text);
  if (form === undefined) scope.errors.add(syntax.form.location, `unknown variant form ${syntax.form.text}`);
  const variant: MutableVariant = {
    name: syntax.name.text,
    form: form ?? "engine",
    cases: [],
    wireWords: 0,
    payloadWords: 0,
    hasSpans: false,
    isPayload: false,
    file,
    location: syntax.name.location,
  };
  scope.declare(scope.variants, syntax.name, variant, otherTypeTables(scope, scope.variants));
}

export function declareTypes(scope: Scope, declarations: readonly DeclarationInFile[]): void {
  declareGeneratedEnums(scope);
  for (const { declaration, file } of declarations) {
    switch (declaration.declares) {
      case "constant": {
        const { name, value } = declaration;
        scope.declare(scope.constants, name, { name: name.text, value, location: name.location });
        break;
      }
      case "enum":
      case "flags":
        declareEnum(scope, declaration, file);
        break;
      case "external":
        declareExternal(scope, declaration);
        break;
      case "opaque":
        declareOpaqueKinds(scope, declaration);
        break;
      case "record":
        declareRecord(scope, declaration, file);
        break;
      case "variant":
        declareVariant(scope, declaration, file);
        break;
      case "include":
      case "heap":
      case "effects":
      case "uses":
      case "parameters":
      case "extend":
      case "list":
      case "natural":
      case "column":
      case "family":
      case "operation":
      case "terminator":
      case "runtime":
      case "inline":
        break;
    }
  }
}

function zeroValueOf(kind: ColumnKind): ColumnValue {
  switch (kind.tag) {
    case "Bool":
      return { tag: "Bool", value: false };
    case "UInt32":
    case "UInt64":
      return { tag: "Integer", value: 0n };
    case "Text":
    case "Name":
      return { tag: "Text", value: "" };
    case "Enum":
      return kind.type.members.length === 0
        ? { tag: "Members", members: [] }
        : { tag: "Member", member: kind.type.members[0] };
    case "Flags":
      return { tag: "Members", members: [] };
  }
}

function appendZeroMember(type: MutableEnum, name: string, isEngine: boolean, location: Location): Mutable<Member> {
  const member = appendMember(type, name, isEngine, location);
  member.values = type.columns.map(column => zeroValueOf(column.kind));
  return member;
}

function appendExtensionMember(type: MutableEnum, name: string, isEngine: boolean, location: Location): Member {
  const member = appendZeroMember(type, name, isEngine, location);
  member.isFromExtension = true;
  return member;
}

function appendOpaqueOperandKinds(scope: Scope): void {
  const operandKinds = scope.enums.get("OperandKind");
  if (operandKinds === undefined) return;
  for (const kind of scope.opaqueKinds.values()) {
    if (operandKinds.members.some(member => member.name === kind.name)) continue;
    appendZeroMember(operandKinds, kind.name, kind.isEngine, kind.location);
  }
}

function resolveMember(scope: Scope, type: SchemaEnum, name: Name): Member | null {
  const member = type.members.find(candidate => candidate.name === name.text);
  if (member !== undefined) return member;
  scope.errors.add(name.location, `${name.text} is not a member of ${type.name}`);
  return null;
}

function resolveColumnKind(scope: Scope, type: Name, kind: Name): ColumnKind {
  const scalar = scalarColumnKinds.find(candidate => candidate === kind.text);
  if (scalar !== undefined) return { tag: scalar };
  const named = scope.enums.get(kind.text);
  if (named !== undefined) return { tag: named.isFlags ? "Flags" : "Enum", type: named };
  scope.errors.add(kind.location, `unknown column kind ${kind.text} of ${type.text}`);
  return { tag: "UInt32" };
}

function valueText(value: ValueSyntax): string {
  switch (value.form) {
    case "Bool":
      return String(value.value);
    case "Integer":
      return value.value.toString();
    case "Text":
      return `"${value.value}"`;
    case "Names":
      return value.names.map(name => name.text).join("+");
  }
}

function resolveFlagNames(scope: Scope, type: SchemaEnum, names: readonly Name[]): ColumnValue {
  if (names.length === 1 && names[0].text === "none") return { tag: "Members", members: [] };
  return { tag: "Members", members: names.flatMap(name => resolveMember(scope, type, name) ?? []) };
}

function findColumnValue(scope: Scope, kind: ColumnKind, value: ValueSyntax): ColumnValue | null {
  switch (kind.tag) {
    case "Bool":
      return value.form === "Bool" ? { tag: "Bool", value: value.value } : null;
    case "UInt32":
    case "UInt64":
      if (value.form !== "Integer" || value.value < 0n || value.value > maximumColumnIntegers[kind.tag]) return null;
      return { tag: "Integer", value: value.value };
    case "Text":
      return value.form === "Text" ? { tag: "Text", value: value.value } : null;
    case "Name":
      return value.form === "Names" && value.names.length === 1 ? { tag: "Text", value: value.names[0].text } : null;
    case "Enum": {
      if (value.form !== "Names" || value.names.length !== 1) return null;
      const member = resolveMember(scope, kind.type, value.names[0]);
      return member === null ? zeroValueOf(kind) : { tag: "Member", member };
    }
    case "Flags":
      return value.form === "Names" ? resolveFlagNames(scope, kind.type, value.names) : null;
  }
}

function resolveColumnValue(
  scope: Scope,
  type: SchemaEnum,
  member: Member,
  column: EnumColumn,
  value: ValueSyntax,
): ColumnValue {
  const resolved = findColumnValue(scope, column.kind, value);
  if (resolved !== null) return resolved;
  const kindName = column.kind.tag === "Enum" || column.kind.tag === "Flags" ? column.kind.type.name : column.kind.tag;
  scope.errors.add(
    value.location,
    `value ${valueText(value)} of member ${member.name} of ${type.name} is not a valid ${kindName}`,
  );
  return zeroValueOf(column.kind);
}

function resolveMemberValues(scope: Scope, type: SchemaEnum, member: Mutable<Member>, syntax: MemberSyntax): void {
  const { columns } = type;
  if (syntax.values.length !== columns.length) {
    const problem = `member ${member.name} of ${type.name} has ${syntax.values.length} values for ${columns.length} columns`;
    scope.errors.add(member.location, problem);
  }
  member.values = columns.map((column, index) =>
    index < syntax.values.length
      ? resolveColumnValue(scope, type, member, column, syntax.values[index])
      : zeroValueOf(column.kind),
  );
}

export function resolveEnums(scope: Scope, declarations: readonly DeclarationInFile[]): void {
  const declared: { readonly type: MutableEnum; readonly syntax: EnumSyntax }[] = [];
  for (const { declaration } of declarations) {
    if (declaration.declares !== "enum" && declaration.declares !== "flags") continue;
    const type = findDeclared(scope.enums, declaration.name);
    if (type !== null) declared.push({ type, syntax: declaration });
  }
  for (const { type, syntax } of declared) {
    type.columns = syntax.columns.map(column => ({
      name: column.name.text,
      kind: resolveColumnKind(scope, syntax.name, column.kind),
      isInRust: false,
    }));
  }
  appendOpaqueOperandKinds(scope);
  for (const { type, syntax } of declared) {
    syntax.members.forEach((member, index) => resolveMemberValues(scope, type, type.members[index], member));
  }
}

function findExtendedEnum(scope: Scope, name: Name): MutableEnum | null {
  const type = scope.enums.get(name.text);
  if (type !== undefined && !type.isFlags && !type.isGenerated) return type;
  scope.errors.add(name.location, `extend: ${name.text} is not an enum`);
  return null;
}

function applyExtension(scope: Scope, syntax: ExtendSyntax): void {
  const target = findExtendedEnum(scope, syntax.target);
  const source = findExtendedEnum(scope, syntax.source);
  if (target === null || source === null) return;
  if (target === source) {
    scope.errors.add(syntax.source.location, `extend: ${target.name} cannot extend itself`);
    return;
  }
  if (target.members.length === 0) {
    scope.errors.add(target.location, `enum ${target.name} has no members`);
    return;
  }
  if (source.columns.some(column => column.name === syntax.column.text)) {
    scope.errors.add(syntax.column.location, `${syntax.column.text} is declared twice`);
    return;
  }
  const targetMembers = new Map(target.members.map(member => [member.name, member]));
  const counterparts = source.members.map((member, position) => {
    if (position === 0) return target.members[0];
    const name = member.name + syntax.suffix.text;
    const existing = targetMembers.get(name);
    if (existing !== undefined) scope.errors.add(syntax.suffix.location, `${name} is declared twice`);
    const counterpart = existing ?? appendExtensionMember(target, name, member.isEngine, syntax.target.location);
    targetMembers.set(name, counterpart);
    return counterpart;
  });
  source.columns.push({ name: syntax.column.text, kind: { tag: "Enum", type: target }, isInRust: false });
  source.members.forEach((member: Mutable<Member>, position) => {
    member.values = [...member.values, { tag: "Member", member: counterparts[position] }];
  });
}

export function applyExtensions(scope: Scope, declarations: readonly DeclarationInFile[]): void {
  for (const { declaration } of declarations) {
    if (declaration.declares === "extend") applyExtension(scope, declaration);
  }
}

function findRecordOrVariant(scope: Scope, word: string): Kind | null {
  const record = scope.records.get(word);
  if (record !== undefined) return { tag: "Record", record };
  const variant = scope.variants.get(word);
  return variant === undefined ? null : { tag: "Variant", variant };
}

function findListOf(scope: Scope, typeName: string): ProgramList | null {
  for (const list of scope.lists.values()) {
    const { element } = list;
    if ((element.tag === "Record" || element.tag === "Variant") && nameOf(element) === typeName) return list;
  }
  return null;
}

export function resolveLists(scope: Scope, declarations: readonly DeclarationInFile[]): void {
  for (const { declaration } of declarations) {
    if (declaration.declares !== "list") continue;
    const list: ProgramList = {
      name: declaration.name.text,
      number: scope.lists.size,
      element: findRecordOrVariant(scope, declaration.element.name.text) ?? placeholderKind,
      keyword: declaration.keyword?.text ?? null,
      prefix: declaration.prefix?.text ?? null,
      isSorted: declaration.isSorted,
      sortedBy: null,
      isTable: false,
      elementSizeInBytes: 0,
      location: declaration.name.location,
    };
    scope.declare(scope.lists, declaration.name, list);
  }
}

export function resolveIdKinds(scope: Scope): void {
  const isEngineByName = new Map<string, boolean>([...functionLocalIdKinds].map(name => [name, false]));
  const payloadKinds = scope.enums.get("PayloadKind");
  const isIdColumn = payloadKinds?.columns.findIndex(column => column.name === "isId") ?? -1;
  for (const member of isIdColumn < 0 ? [] : (payloadKinds?.members ?? [])) {
    const isId = member.values[isIdColumn];
    if (isId.tag !== "Bool" || !isId.value || scope.externals.has(member.name)) continue;
    if (!isEngineByName.has(member.name)) isEngineByName.set(member.name, member.isEngine);
  }
  for (const { element, prefix } of scope.lists.values()) {
    if (prefix === null || (element.tag !== "Record" && element.tag !== "Variant")) continue;
    if (!isEngineByName.has(nameOf(element))) isEngineByName.set(nameOf(element), false);
  }
  for (const isEngine of [false, true]) {
    for (const [name, isEngineKind] of isEngineByName) {
      if (isEngineKind !== isEngine) continue;
      scope.idKinds.set(name, {
        name,
        isEngine,
        list: findListOf(scope, name),
        record: scope.records.get(name) ?? null,
      });
    }
  }
}

export function findKind(scope: Scope, word: string, position: KindPosition): Kind | null {
  const id = scope.idKinds.get(word);
  const isListedType =
    position === "list" || (position === "span" && id === undefined && findListOf(scope, word) !== null);
  const listedType = isListedType ? findRecordOrVariant(scope, word) : null;
  if (listedType !== null) return listedType;
  if (id !== undefined) return { tag: "Id", id, role: null };
  const placedWord = placedWordKinds.find(candidate => candidate === word);
  if (placedWord !== undefined) return { tag: "PlacedWord", word: placedWord };
  const scalar = scalarKinds.find(candidate => candidate === word);
  if (scalar !== undefined) return { tag: "Scalar", scalar };
  const external = scope.externals.get(word);
  if (external !== undefined) return { tag: "External", external };
  const type = scope.enums.get(word);
  if (type !== undefined) return { tag: type.isFlags ? "Flags" : "Enum", type };
  return findRecordOrVariant(scope, word);
}

function resolveRole(scope: Scope, kind: Kind, word: string, role: Name): Kind {
  const enumName = kind.tag === "Id" ? roleEnumNames.get(kind.id.name) : undefined;
  if (kind.tag !== "Id" || enumName === undefined) {
    scope.errors.add(role.location, `unknown role ${role.text} of ${word}`);
    return kind;
  }
  const roles = scope.enums.get(enumName);
  return roles === undefined ? kind : { ...kind, role: resolveMember(scope, roles, role) };
}

export function resolveKind(scope: Scope, syntax: KindSyntax, position: KindPosition): Kind {
  const { name, role, element, arrayLength } = syntax;
  const word = name.text;
  if (arrayLength !== null && position !== "field") {
    scope.errors.add(name.location, `${word}[${arrayLength}]: only a field of a record is an array`);
  }
  const holdsElements = word === "List" || (word === "Span" && position !== "payload");
  if (holdsElements && element !== null) {
    if (role !== null) scope.errors.add(role.location, `unknown role ${role.text} of ${word}`);
    if (word === "Span") return { tag: "Span", element: resolveKind(scope, element, "span") };
    return { tag: "List", element: resolveKind(scope, element, "payload") };
  }
  const kind = findKind(scope, word, position);
  if (kind === null) {
    scope.errors.add(name.location, `unknown ${position === "payload" ? "payload kind" : "kind"} ${word}`);
    return placeholderKind;
  }
  if (element !== null) scope.errors.add(name.location, `${word} takes no element`);
  return role === null ? kind : resolveRole(scope, kind, word, role);
}

function resolveFields(
  scope: Scope,
  fields: readonly FieldSyntax[],
  owner: string,
  sortedFields: SortedField[],
): Field[] {
  return fields.map(syntax => {
    const { arrayLength } = syntax.kind;
    const field: Mutable<Field> = {
      name: syntax.name.text,
      kind: resolveKind(scope, syntax.kind, "field"),
      isOptional: syntax.isOptional,
      isEngine: syntax.isEngine,
      arrayLength: typeof arrayLength === "bigint" ? Number(arrayLength) : null,
      isOnePerList: arrayLength === "lists",
      isSorted: syntax.isSorted,
      sortedBy: null,
      wireWords: 0,
      payloadWords: 0,
      location: syntax.name.location,
    };
    if (syntax.sortedBy !== null) sortedFields.push({ field, syntax, key: syntax.sortedBy, owner });
    return field;
  });
}

function findSortKey(element: Kind, key: Name): Field | null {
  if (element.tag !== "Record") return null;
  return element.record.fields.find(field => field.name === key.text) ?? null;
}

function resolveFieldSortKey(scope: Scope, { field, syntax, key, owner }: SortedField): void {
  const { kind } = field;
  field.sortedBy = findSortKey(kind.tag === "Span" || kind.tag === "List" ? kind.element : kind, key);
  if (field.sortedBy !== null) return;
  const elementName = (syntax.kind.element ?? syntax.kind).name.text;
  scope.errors.add(
    key.location,
    `field ${field.name} of ${owner} is sorted by ${key.text}, which ${elementName} does not have`,
  );
}

function resolveListElement(scope: Scope, syntax: ListSyntax): void {
  const list: Mutable<ProgramList> | null = findDeclared(scope.lists, syntax.name);
  if (list === null) return;
  list.element = resolveKind(scope, syntax.element, "list");
  const key = syntax.sortedBy;
  if (key === null) return;
  list.sortedBy = findSortKey(list.element, key);
  if (list.sortedBy !== null) return;
  scope.errors.add(
    key.location,
    `list ${list.name} is sorted by ${key.text}, which ${syntax.element.name.text} does not have`,
  );
}

export function resolveRecords(scope: Scope, declarations: readonly DeclarationInFile[]): void {
  const sortedFields: SortedField[] = [];
  for (const { declaration } of declarations) {
    if (declaration.declares === "record") {
      const record = findDeclared(scope.records, declaration.name);
      if (record === null) continue;
      record.fields = resolveFields(scope, declaration.fields, record.name, sortedFields);
      record.wireFields = record.fields.filter(field => !field.isEngine);
    } else if (declaration.declares === "variant") {
      const variant = findDeclared(scope.variants, declaration.name);
      if (variant === null) continue;
      variant.cases = declaration.cases.map((syntax, number) => ({
        name: syntax.name.text,
        number,
        fields: resolveFields(scope, syntax.fields, variant.name, sortedFields),
        location: syntax.name.location,
      }));
    }
  }
  for (const { declaration } of declarations) {
    if (declaration.declares === "list") resolveListElement(scope, declaration);
  }
  for (const sortedField of sortedFields) resolveFieldSortKey(scope, sortedField);
}

function computeAbiLayout(record: SchemaRecord): AbiLayout {
  const offsets: number[] = [];
  let size = 0;
  let alignment = 1;
  for (const { kind, arrayLength } of record.fields) {
    let element = { size: 4, alignment: 4 };
    if (kind.tag === "Scalar" && kind.scalar === "UInt8") element = { size: 1, alignment: 1 };
    else if (kind.tag === "Scalar" && (kind.scalar === "UInt64" || kind.scalar === "Double"))
      element = { size: 8, alignment: 8 };
    else if (kind.tag === "Record" && kind.record.abiLayout !== null) element = kind.record.abiLayout;
    size = roundUp(size, element.alignment);
    offsets.push(size);
    size += element.size * (arrayLength ?? 1);
    alignment = Math.max(alignment, element.alignment);
  }
  return { size: roundUp(size, alignment), alignment, offsets };
}

function startSizing(
  computation: SizeComputation,
  type: SchemaRecord | Variant,
  description: "record" | "variant",
): boolean {
  if (computation.finished.has(type)) return false;
  if (computation.active.has(type)) {
    computation.scope.errors.add(type.location, `${description} ${type.name} contains itself`);
    computation.finished.add(type);
    return false;
  }
  computation.active.add(type);
  return true;
}

function finishSizing(computation: SizeComputation, type: SchemaRecord | Variant): void {
  computation.active.delete(type);
  computation.finished.add(type);
}

function holdsSpans({ kind }: Field): boolean {
  if (kind.tag === "Record") return kind.record.hasSpans;
  if (kind.tag === "Variant") return kind.variant.hasSpans;
  return kind.tag === "Span" || kind.tag === "List";
}

function computeKindSizes(computation: SizeComputation, kind: Kind): Sizes {
  switch (kind.tag) {
    case "List":
      return { wireWords: 0, payloadWords: 0 };
    case "Record":
      computeRecordSizes(computation, kind.record);
      return kind.record;
    case "Variant":
      computeVariantSizes(computation, kind.variant);
      return kind.variant;
    case "Scalar":
    case "Id":
    case "PlacedWord":
    case "Enum":
    case "Flags":
    case "External":
    case "Span":
      return { wireWords: wireWordsOf(kind), payloadWords: wireWordsOf(kind) };
  }
}

function computeFieldSizes(computation: SizeComputation, field: Mutable<Field>): void {
  const count = field.isOnePerList ? computation.scope.lists.size : (field.arrayLength ?? 1);
  const { wireWords, payloadWords } = computeKindSizes(computation, field.kind);
  field.wireWords = wireWords * count;
  field.payloadWords = payloadWords * count;
}

function computeRecordSizes(computation: SizeComputation, record: Mutable<SchemaRecord>): void {
  if (!startSizing(computation, record, "record")) return;
  for (const field of record.fields) computeFieldSizes(computation, field);
  finishSizing(computation, record);
  record.wireWords = sumOf(record.wireFields, field => field.wireWords);
  record.payloadWords = sumOf(record.fields, field => field.payloadWords);
  record.hasSpans = record.wireFields.some(holdsSpans);
  if (record.form === "abi") record.abiLayout = computeAbiLayout(record);
}

function computeVariantSizes(computation: SizeComputation, variant: Mutable<Variant>): void {
  if (!startSizing(computation, variant, "variant")) return;
  for (const { fields } of variant.cases) {
    for (const field of fields) computeFieldSizes(computation, field);
  }
  finishSizing(computation, variant);
  const wireFieldsByCase = variant.cases.map(({ fields }) => fields.filter(field => !field.isEngine));
  variant.wireWords = 1 + Math.max(0, ...wireFieldsByCase.map(fields => sumOf(fields, field => field.wireWords)));
  variant.payloadWords =
    1 + Math.max(0, ...variant.cases.map(({ fields }) => sumOf(fields, field => field.payloadWords)));
  variant.hasSpans = wireFieldsByCase.some(fields => fields.some(holdsSpans));
}

function reachesEngineFields(type: SchemaType, visited: Set<string>): boolean {
  if (visited.has(nameOf(type))) return false;
  visited.add(nameOf(type));
  return fieldsOf(type).some(field => {
    if (field.isEngine) return true;
    const inner = innermostKindOf(field.kind);
    if (inner.tag === "Record")
      return inner.record.form === "wire" && !inner.record.isCustomEngine && reachesEngineFields(inner, visited);
    return inner.tag === "Variant" && inner.variant.form === "wire" && reachesEngineFields(inner, visited);
  });
}

function isColumnInRust(kind: ColumnKind): boolean {
  switch (kind.tag) {
    case "Name":
      return false;
    case "Bool":
    case "UInt32":
    case "UInt64":
    case "Text":
      return true;
    case "Enum":
    case "Flags":
      return kind.type.wireMemberCount > 0;
  }
}

function finishList(computation: SizeComputation, list: Mutable<ProgramList>): void {
  const { element } = list;
  const isByte = element.tag === "Scalar" && element.scalar === "Byte";
  const hasId =
    (element.tag === "Record" || element.tag === "Variant") && computation.scope.idKinds.has(nameOf(element));
  list.elementSizeInBytes = isByte ? 1 : 4 * computeKindSizes(computation, element).wireWords;
  list.isTable = hasId || list.keyword !== null;
}

export function computeWords(scope: Scope): void {
  const computation: SizeComputation = { scope, active: new Set(), finished: new Set() };
  for (const record of scope.records.values()) {
    computeRecordSizes(computation, record);
    record.hasEngineFields = reachesEngineFields({ tag: "Record", record }, new Set());
  }
  for (const variant of scope.variants.values()) computeVariantSizes(computation, variant);
  for (const list of scope.lists.values()) finishList(computation, list);
  for (const type of scope.enums.values()) {
    for (const column of type.columns) (column as Mutable<EnumColumn>).isInRust = isColumnInRust(column.kind);
  }
}

function markPayloadKind(kind: Kind): void {
  switch (kind.tag) {
    case "List":
      markPayloadKind(kind.element);
      return;
    case "Record":
      if (kind.record.isPayload) return;
      (kind.record as Mutable<SchemaRecord>).isPayload = true;
      break;
    case "Variant":
      if (kind.variant.isPayload) return;
      (kind.variant as Mutable<Variant>).isPayload = true;
      break;
    case "Scalar":
    case "Id":
    case "PlacedWord":
    case "Enum":
    case "Flags":
    case "External":
    case "Span":
      return;
  }
  const wireFields = kind.tag === "Record" ? kind.record.wireFields : fieldsOf(kind);
  for (const field of wireFields) markPayloadKind(field.kind);
}

// Only the Rust outputs read the mark, so nothing that stays in the engine sets it.
export function markPayloadTypes(scope: Scope): void {
  for (const entry of scope.entries.values()) {
    if (!entry.isWire) continue;
    for (const parameter of wireParametersOf(entry)) {
      if (parameter.tag === "Payload") markPayloadKind(parameter.kind);
    }
  }
}
