import { canBeOptional, engineKindNameOf } from "./check-types.ts";
import { kindText } from "./hash.ts";
import type {
  Entry,
  Field,
  Flag,
  IdKind,
  Kind,
  Member,
  Operand,
  Parameter,
  PayloadField,
  Result,
  Schema,
  SchemaRecord,
  Variant,
} from "./model.ts";
import {
  entriesOf,
  fieldsOf,
  forms,
  idKindsWithRoles,
  innermostKindOf,
  isId,
  isLegalIn,
  listPayloadOf,
  wireParametersOf,
} from "./model.ts";
import { cppSetterName, lowerFirst, reservedAccessorNames, rustIdentifier } from "./names.ts";
import { compareLocations, type ErrorList } from "./source.ts";

const maxFlags = 8;
const exclusiveParameterCount = 2;
const firstForm = forms[0];
const conditionOperandName = "condition";
const builtinNameExternal = "BuiltinName";
const accessesWithStoredValue: ReadonlySet<string> = new Set(["Store", "Define"]);
const columnsReadByRust: readonly string[] = ["isIntrinsic"];

export function equalsIgnoringRoles(left: Kind, right: Kind): boolean {
  switch (left.tag) {
    case "Scalar":
      return right.tag === "Scalar" && left.scalar === right.scalar;
    case "Id":
      return right.tag === "Id" && left.id === right.id;
    case "PlacedWord":
      return right.tag === "PlacedWord" && left.word === right.word;
    case "Enum":
      return right.tag === "Enum" && left.type === right.type;
    case "Flags":
      return right.tag === "Flags" && left.type === right.type;
    case "External":
      return right.tag === "External" && left.external === right.external;
    case "Record":
      return right.tag === "Record" && left.record === right.record;
    case "Variant":
      return right.tag === "Variant" && left.variant === right.variant;
    case "Span":
      return right.tag === "Span" && equalsIgnoringRoles(left.element, right.element);
    case "List":
      return right.tag === "List" && equalsIgnoringRoles(left.element, right.element);
  }
}

export function findIndexFieldOfElements(kind: Kind, indexKind: Kind): Field | null {
  if (kind.tag !== "List" || kind.element.tag !== "Record") return null;
  const candidates = kind.element.record.fields.filter(
    field => !field.isOptional && equalsIgnoringRoles(field.kind, indexKind),
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function operandsOf(entry: Entry): Operand[] {
  return entry.parameters.filter((parameter): parameter is Operand => parameter.tag === "Operand");
}

function hasSameAccessor(left: PayloadField, right: PayloadField): boolean {
  if (!equalsIgnoringRoles(left.kind, right.kind)) return false;
  return left.isOptional === right.isOptional || isId(left.kind);
}

function checkPayloadKinds(entries: readonly Entry[], errors: ErrorList): void {
  const firstFields = new Map<string, PayloadField>();
  for (const field of entries.flatMap(entry => entry.payload)) {
    const first = firstFields.get(field.name);
    if (first === undefined) firstFields.set(field.name, field);
    else if (!hasSameAccessor(first, field)) errors.add(field.location, `payload field ${field.name} has two kinds`);
  }
}

function checkFlagNames(entries: readonly Entry[], errors: ErrorList): void {
  const payloadNames = new Set(entries.flatMap(entry => entry.payload.map(field => field.name)));
  const reported = new Set<string>();
  for (const entry of entries) {
    for (const flag of entry.flags) {
      const isDeclaredTwiceInEntry = entry.payload.some(field => field.name === flag.name);
      if (!payloadNames.has(flag.name) || isDeclaredTwiceInEntry || reported.has(flag.name)) continue;
      reported.add(flag.name);
      errors.add(flag.location, `${flag.name} is a payload field and a flag`);
    }
  }
}

function checkRustNames(entries: readonly Entry[], errors: ErrorList): void {
  const owners = new Map<string, Entry>();
  for (const entry of entries) {
    if (!entry.isWire) continue;
    const identifier = rustIdentifier(entry.name);
    const owner = owners.get(identifier);
    if (owner === undefined) owners.set(identifier, entry);
    else errors.add(entry.location, `${owner.name} and ${entry.name} both map to the Rust name ${identifier}`);
  }
}

function checkPayloadNames(entries: readonly Entry[], errors: ErrorList): void {
  checkPayloadKinds(entries, errors);
  checkFlagNames(entries, errors);
  checkRustNames(entries, errors);
}

function checkAccessorName(
  description: "payload field" | "flag",
  item: PayloadField | Flag,
  entry: Entry,
  errors: ErrorList,
): void {
  if (!reservedAccessorNames.has(item.name) && !reservedAccessorNames.has(cppSetterName(item.name))) return;
  errors.add(item.location, `${description} ${item.name} of ${entry.name} has the name of a member of Value`);
}

function checkNames(entry: Entry, errors: ErrorList): void {
  const names = new Set<string>();
  for (const item of [...entry.parameters, ...entry.flags]) {
    if (names.has(item.name)) errors.add(item.location, `${item.name} is declared twice in ${entry.name}`);
    names.add(item.name);
  }
  for (const field of entry.payload) checkAccessorName("payload field", field, entry, errors);
  for (const flag of entry.flags) checkAccessorName("flag", flag, entry, errors);
}

function collectIdKindsWithoutRole(kind: Kind, found: Set<IdKind>, visited: Set<SchemaRecord | Variant>): void {
  switch (kind.tag) {
    case "Id":
      if (kind.role === null && idKindsWithRoles.has(kind.id.name)) found.add(kind.id);
      return;
    case "Span":
    case "List":
      collectIdKindsWithoutRole(kind.element, found, visited);
      return;
    case "Record":
    case "Variant": {
      const type = kind.tag === "Record" ? kind.record : kind.variant;
      if (type.form === "abi" || visited.has(type)) return;
      visited.add(type);
      for (const field of fieldsOf(kind)) collectIdKindsWithoutRole(field.kind, found, visited);
      return;
    }
    case "Scalar":
    case "PlacedWord":
    case "Enum":
    case "Flags":
    case "External":
      return;
  }
}

function checkPayloadField(field: PayloadField, entry: Entry, errors: ErrorList): void {
  const { kind, location } = field;
  const subject = `field ${field.name} of ${entry.name}`;
  if (field.firstForm !== firstForm && !isLegalIn(entry, field.firstForm)) {
    errors.add(location, `${subject} starts in ${field.firstForm}, where ${entry.name} is not legal`);
  }
  const withoutRole = new Set<IdKind>();
  collectIdKindsWithoutRole(kind, withoutRole, new Set());
  for (const id of withoutRole) errors.add(location, `payload ${subject}: a ${id.name} needs a role`);
  if (field.isOptional && !canBeOptional(kind)) {
    errors.add(location, `${subject}: ${kindText(kind)} cannot be optional`);
  }
}

function checkFlags(entry: Entry, errors: ErrorList): void {
  if (entry.flags.length > maxFlags) errors.add(entry.location, `${entry.name} has more than ${maxFlags} flags`);
  let followsEngineFlag = false;
  for (const flag of entry.flags) {
    if (followsEngineFlag && !flag.isEngine) {
      errors.add(flag.location, `wire flag ${flag.name} of ${entry.name} follows an engine flag`);
    }
    followsEngineFlag ||= flag.isEngine;
  }
}

function checkParameters(entry: Entry, errors: ErrorList): void {
  const operands = operandsOf(entry);
  const variadic = operands.find(operand => operand.isVariadic);
  if (variadic !== undefined && variadic !== operands[operands.length - 1]) {
    errors.add(variadic.location, `the variadic operand of ${entry.name} is not its last operand`);
  }
  for (const operand of operands) {
    if (!operand.isEngine || operand.isOptional) continue;
    errors.add(operand.location, `engine operand ${operand.name} of ${entry.name} is not optional`);
  }
  if (entry.payload.filter(field => field.kind.tag === "List").length > 1) {
    errors.add(entry.location, `${entry.name} has two List fields`);
  }
  for (const field of entry.payload) checkPayloadField(field, entry, errors);
  checkFlags(entry, errors);
}

function engineKindNameOfParameter(parameter: Parameter): string | null {
  if (parameter.tag === "Payload") return engineKindNameOf(parameter.kind);
  return parameter.kind.isEngine ? parameter.kind.name : null;
}

function membersReadByRust(entry: Entry): Member[] {
  const members: Member[] = [];
  for (const column of columnsReadByRust) {
    const value = entry.columns.get(column);
    if (value?.tag === "Member") members.push(value.member);
    if (value?.tag === "Members") members.push(...value.members);
  }
  for (const parameter of wireParametersOf(entry)) {
    if (parameter.tag !== "Payload" || engineKindNameOf(parameter.kind) !== null) continue;
    const { kind } = parameter;
    const inner = innermostKindOf(kind);
    members.push(parameter.payloadKind);
    if (inner.tag === "Id" && inner.role !== null) members.push(inner.role);
    if (kind.tag === "Enum" && !parameter.isOptional) members.push(kind.type.members[0]);
  }
  return members;
}

function checkWireEntry(entry: Entry, errors: ErrorList): void {
  for (const parameter of wireParametersOf(entry)) {
    const engineKind = engineKindNameOfParameter(parameter);
    if (engineKind !== null) errors.add(entry.location, `wire entry ${entry.name} names the engine kind ${engineKind}`);
  }
  for (const member of membersReadByRust(entry)) {
    if (!member.isEngine) continue;
    errors.add(entry.location, `wire entry ${entry.name} uses the engine-only member ${member.name}`);
  }
}

function checkUses(entry: Entry, builtinNames: ReadonlySet<string>, errors: ErrorList): void {
  for (const operand of operandsOf(entry)) {
    const { location } = operand;
    const { namedMembers, protocols, uses } = operand.uses;
    const subject = `operand ${operand.name} of ${entry.name}`;
    if (uses.length === 0 && protocols.length === 0) errors.add(location, `${subject} has no use`);
    for (const use of uses.filter((member, index) => uses.indexOf(member) < index)) {
      errors.add(location, `${subject} lists ${lowerFirst(use.name)} twice`);
    }
    for (const member of namedMembers) {
      if (builtinNames.has(member)) continue;
      errors.add(location, `Named(${member}) of ${entry.name}: ${member} is not a member of ${builtinNameExternal}`);
    }
  }
}

export function nonzeroMemberOf(entry: Entry, column: string): Member | null {
  const value = entry.columns.get(column);
  return value?.tag === "Member" && value.member.number !== 0 ? value.member : null;
}

function isTrue(entry: Entry, column: string): boolean {
  const value = entry.columns.get(column);
  return value?.tag === "Bool" && value.value;
}

function isNaturalBoolean(result: Result): boolean {
  const rule = result.unproven;
  if (result.proven !== null || rule.rule !== "Natural" || rule.natural.tag !== "Type") return false;
  const { builtinClass, integers, isFunction, isObject, opaque, primitives } = rule.natural.type;
  const holdsBothBooleans = primitives.length === 2 && primitives.includes("False") && primitives.includes("True");
  return holdsBothBooleans && integers === null && !isObject && !isFunction && opaque === null && builtinClass === null;
}

function checkAccessColumns(entry: Entry, errors: ErrorList): void {
  const access = nonzeroMemberOf(entry, "access");
  if (access === null) return;
  if (!entry.columns.has("receiver")) errors.add(entry.location, `access of ${entry.name} needs receiver`);
  if (accessesWithStoredValue.has(access.name) && !entry.columns.has("stored")) {
    errors.add(entry.location, `access = ${access.name} of ${entry.name} needs stored`);
  }
}

function checkCollectorColumns(entry: Entry, errors: ErrorList): void {
  const { effects, location, name } = entry;
  if (isTrue(entry, "runsOwnerBarrier") && !operandsOf(entry).some(operand => operand.uses.retainedIn === "Operand")) {
    errors.add(location, `${name} sets runsOwnerBarrier and retains no operand in another operand`);
  }
  if (isTrue(entry, "allocatesAfterLastSafepoint") && entry.result.unproven.rule !== "Allocation") {
    errors.add(location, `${name} sets allocatesAfterLastSafepoint and its result is not an allocation`);
  }
  if (isTrue(entry, "allocatesInline") && !effects.collects && !effects.isUnknownCode) {
    errors.add(location, `${name} sets allocatesInline and does not collect`);
  }
}

function checkReplacedEntries(entry: Entry, errors: ErrorList): void {
  const value = entry.columns.get("replaces");
  if (value?.tag !== "Operations") return;
  for (const replaced of value.entries) {
    if (forms.indexOf(replaced.firstForm) <= forms.indexOf(entry.lastForm)) continue;
    errors.add(entry.location, `replaces of ${entry.name}: ${replaced.name} starts in a later form`);
  }
}

function checkExclusiveParameters(entry: Entry, errors: ErrorList): void {
  const value = entry.columns.get("exactlyOneOf");
  if (value?.tag !== "Parameters") return;
  const subject = `exactlyOneOf of ${entry.name}`;
  const count = value.parameters.length;
  if (count !== exclusiveParameterCount) {
    errors.add(entry.location, `${subject} takes ${exclusiveParameterCount} parameters and names ${count}`);
  }
  for (const parameter of value.parameters) {
    if (!parameter.isOptional) errors.add(entry.location, `${subject}: ${parameter.name} is not optional`);
  }
}

function checkColumns(entry: Entry, errors: ErrorList): void {
  checkAccessColumns(entry, errors);
  const proof = nonzeroMemberOf(entry, "proves");
  if (proof !== null && !entry.isTerminator && !isNaturalBoolean(entry.result)) {
    errors.add(entry.location, `${entry.name} proves ${proof.name} and its result is not natural(boolean)`);
  }
  checkCollectorColumns(entry, errors);
  checkReplacedEntries(entry, errors);
  if (entry.lastForm === firstForm && nonzeroMemberOf(entry, "removedBy") === null) {
    errors.add(entry.location, `${entry.name} ends at ${firstForm} and has no removedBy`);
  }
  checkExclusiveParameters(entry, errors);
}

function checkCases(entry: Entry, errors: ErrorList): void {
  if (!entry.targets.some(target => target.isVariadic) || listPayloadOf(entry) !== null) return;
  errors.add(entry.location, `${entry.name} has cases and no List field`);
}

function checkTargets(entry: Entry, errors: ErrorList): void {
  const { location, name, targets } = entry;
  if (targets.filter(target => target.isVariadic).length > 1) errors.add(location, `${name} has two variadic targets`);
  const hasCondition = operandsOf(entry).some(operand => operand.name === conditionOperandName);
  if (hasCondition || nonzeroMemberOf(entry, "proves") !== null) return;
  for (const target of targets) {
    if (!target.takesProofs) continue;
    const problem = `takes proofs and ${name} has neither a ${conditionOperandName} operand nor proves`;
    errors.add(target.location, `target ${target.name} of ${name} ${problem}`);
  }
}

export function checkEntries(schema: Schema, errors: ErrorList): void {
  const compare = compareLocations(schema.files);
  const entries = entriesOf(schema).sort((left, right) => compare(left.location, right.location));
  const builtinNames = new Set(schema.externals.find(external => external.name === builtinNameExternal)?.members);
  const hasFlowColumn = schema.entryColumns.some(column => column.name === "flow");
  checkPayloadNames(entries, errors);
  for (const entry of entries) {
    checkNames(entry, errors);
    checkParameters(entry, errors);
    if (entry.isWire) checkWireEntry(entry, errors);
    checkUses(entry, builtinNames, errors);
    checkColumns(entry, errors);
    if (hasFlowColumn && !entry.isTerminator && entry.firstForm === firstForm && !entry.columns.has("flow")) {
      errors.add(entry.location, `${entry.name} is legal in ${firstForm} and has no flow`);
    }
    checkCases(entry, errors);
    checkTargets(entry, errors);
  }
}
