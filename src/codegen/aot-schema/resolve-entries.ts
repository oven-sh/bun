import type {
  EffectRuleName,
  Effects,
  EntryColumn,
  EntryColumnKind,
  EntryColumnValue,
  Flag,
  Form,
  Heap,
  HeapIndex,
  HeapMark,
  HeapReference,
  Kind,
  Member,
  Operand,
  OperandUses,
  Parameter,
  PayloadField,
  Result,
  SchemaEnum,
  SchemaFile,
} from "./model.ts";
import { effectRules, forms, heapMarks, payloadWordsOf } from "./model.ts";
import { upperFirst } from "./names.ts";
import type { DeclarationInFile } from "./parse.ts";
import { resolveResult, resolveTargets, type EntryParts } from "./resolve-results.ts";
import { findKind, resolveKind } from "./resolve-types.ts";
import type { Mutable, MutableEntry, Scope } from "./resolve.ts";
import type {
  ColumnValueSyntax,
  EffectItemSyntax,
  EffectsSyntax,
  EntrySyntax,
  FamilySyntax,
  FormRangeSyntax,
  HeapReferenceSyntax,
  KindSyntax,
  Name,
  ParameterGroupSyntax,
  ParameterSyntax,
  UseSyntax,
  ValueSyntax,
} from "./syntax.ts";

type WrittenParameter = Exclude<ParameterSyntax, { readonly form: "Group" }>;
type OperandSyntax = Extract<ParameterSyntax, { readonly form: "Operand" }>;
type PayloadSyntax = Extract<ParameterSyntax, { readonly form: "Payload" }>;
type HeapListSyntax = Extract<EffectItemSyntax, { readonly form: "Reads" | "Writes" }>;
type EffectFlag = "isUnknownCode" | "isAsOverload" | "throws" | "collects" | "suspends" | "terminates";
type MutableEffects = Mutable<Effects> & { reads: HeapReference[]; writes: HeapReference[] };
type MutableUses = Mutable<OperandUses> & { uses: Member[]; protocols: Member[]; namedMembers: string[] };
type ColumnOwner = Pick<EntryParts, "name" | "parameters">;
type Finder<Item> = (name: string) => Item | undefined;

interface EntryHead {
  readonly name: string;
  readonly operands: readonly Name[];
}

interface WrittenWords {
  readonly scope: Scope;
  readonly subject: string;
  readonly words: readonly Name[];
}

interface WrittenColumn {
  readonly column: EntryColumn;
  readonly values: readonly ValueSyntax[];
}

interface PendingColumn extends WrittenColumn {
  readonly entry: MutableEntry;
}

interface FamilyState {
  family: string | null;
  forms: readonly [Form, Form];
  defaults: readonly ColumnValueSyntax[];
  readonly declaredGroups: Set<string>;
  readonly pendingColumns: PendingColumn[];
}

const effectFlags: ReadonlyMap<string, EffectFlag> = new Map<string, EffectFlag>([
  ["unknownCode", "isUnknownCode"],
  ["asOverload", "isAsOverload"],
  ["throws", "throws"],
  ["collects", "collects"],
  ["suspends", "suspends"],
  ["terminates", "terminates"],
]);
const plainColumnKinds = ["Bool", "UInt32", "Operand", "Parameters", "Operations", "RuntimeOperation"] as const;
const enumSetColumnKinds: ReadonlyMap<string, string> = new Map([["Proofs", "Proof"]]);
const ownerBarrierFlags = ["ownerCannotBeMarked", "laterBarrierCovers"] as const;
const maximumUInt32 = 0xffffffffn;
const noResult: Result = { unproven: { rule: "None" }, proven: null };

function findMember(type: SchemaEnum | undefined, name: string): Member | undefined {
  return type?.members.find(member => member.name === name);
}

function isOperand(parameter: Parameter): parameter is Operand {
  return parameter.tag === "Operand";
}

function isPayloadField(parameter: Parameter): parameter is PayloadField {
  return parameter.tag === "Payload";
}

function createStandInMember(name: Name): Member {
  return { name: name.text, number: 0, isEngine: false, isFromExtension: false, values: [], location: name.location };
}

function createKindSyntax(name: Name): KindSyntax {
  return { name, role: null, element: null, arrayLength: null };
}

export function resolveHeaps(scope: Scope, declarations: readonly DeclarationInFile[]): void {
  for (const { declaration } of declarations) {
    if (declaration.declares !== "heap") continue;
    const { name } = declaration;
    const marks = new Set<HeapMark>();
    for (const word of declaration.marks) {
      const mark = heapMarks.find(candidate => candidate === word.text);
      if (mark === undefined) scope.errors.add(word.location, `unknown mark ${word.text} of heap ${name.text}`);
      else marks.add(mark);
    }
    const heap: Heap = {
      name: name.text,
      number: scope.heaps.size,
      indexKinds: declaration.indexKinds.map(kind => resolveKind(scope, createKindSyntax(kind), "payload")),
      marks,
      location: name.location,
    };
    scope.declare(scope.heaps, name, heap);
  }
}

function isSameIndex(first: HeapIndex, second: HeapIndex): boolean {
  if (first.tag === "Payload") return second.tag === "Payload" && first.field === second.field;
  return second.tag === "Member" && first.member === second.member;
}

function addHeapReference(references: HeapReference[], added: HeapReference): void {
  const isListed = references.some(
    ({ heap, indexes }) =>
      heap === added.heap &&
      indexes.length === added.indexes.length &&
      indexes.every((index, position) => isSameIndex(index, added.indexes[position])),
  );
  if (!isListed) references.push(added);
}

function mergeEffects(effects: MutableEffects, added: Effects): void {
  for (const flag of effectFlags.values()) effects[flag] ||= added[flag];
  effects.readsAllHeaps ||= added.readsAllHeaps;
  effects.writesAllHeaps ||= added.writesAllHeaps;
  for (const reference of added.reads) addHeapReference(effects.reads, reference);
  for (const reference of added.writes) addHeapReference(effects.writes, reference);
}

function resolveHeapReference(
  scope: Scope,
  syntax: HeapReferenceSyntax,
  payload: readonly PayloadField[],
  owner: string,
): HeapReference | null {
  const heap = scope.heaps.get(syntax.heap.text);
  if (heap === undefined) {
    scope.errors.add(syntax.heap.location, `unknown heap ${syntax.heap.text}`);
    return null;
  }
  const indexes = syntax.indexes.flatMap((index, position): HeapIndex[] => {
    const kind = heap.indexKinds.at(position);
    const type = kind?.tag === "Enum" ? kind.type : undefined;
    const member = findMember(type, index.text);
    if (type !== undefined && member !== undefined) return [{ tag: "Member", type, member }];
    const field = payload.find(candidate => candidate.name === index.text);
    if (field !== undefined) return [{ tag: "Payload", field }];
    const subject = `index ${index.text} of heap ${heap.name} in ${owner}`;
    const problem = `names neither a member of ${type?.name ?? "an index enum"} nor a payload field`;
    scope.errors.add(index.location, `${subject} ${problem}`);
    return [];
  });
  if (indexes.length !== syntax.indexes.length) return { heap, indexes: [] };
  if (indexes.length === 0 || indexes.length === heap.indexKinds.length) return { heap, indexes };
  const counts = `has ${indexes.length} indexes for ${heap.indexKinds.length} index kinds`;
  scope.errors.add(syntax.heap.location, `heap ${heap.name} in ${owner} ${counts}`);
  return { heap, indexes: [] };
}

function addHeaps(
  scope: Scope,
  effects: MutableEffects,
  list: HeapListSyntax,
  payload: readonly PayloadField[],
  owner: string,
): void {
  const isRead = list.form === "Reads";
  for (const syntax of list.heaps) {
    if (syntax.heap.text === "all" && syntax.indexes.length === 0) {
      if (isRead) effects.readsAllHeaps = true;
      else effects.writesAllHeaps = true;
      continue;
    }
    const reference = resolveHeapReference(scope, syntax, payload, owner);
    if (reference !== null) addHeapReference(isRead ? effects.reads : effects.writes, reference);
  }
}

export function resolveEffects(
  scope: Scope,
  syntax: EffectsSyntax,
  payload: readonly PayloadField[],
  owner: string,
): Effects {
  const effects: MutableEffects = {
    isUnknownCode: false,
    isAsOverload: false,
    readsAllHeaps: false,
    writesAllHeaps: false,
    reads: [],
    writes: [],
    throws: false,
    collects: false,
    suspends: false,
    terminates: false,
  };
  const listedFlags = new Set<EffectFlag>();
  for (const item of syntax.items) {
    if (item.form !== "Word") {
      addHeaps(scope, effects, item, payload, owner);
      continue;
    }
    const { text, location } = item.word;
    const flag = effectFlags.get(text);
    const set = scope.namedSets.effects.get(text);
    if (flag !== undefined) {
      if (listedFlags.has(flag)) scope.errors.add(location, `${owner} lists ${text} twice`);
      listedFlags.add(flag);
      effects[flag] = true;
    } else if (set !== undefined) {
      mergeEffects(effects, set.effects);
    } else if (text !== "none") {
      scope.errors.add(location, `unknown effect ${text}`);
    }
  }
  return effects;
}

function addProtocols(scope: Scope, resolved: MutableUses, use: UseSyntax): void {
  for (const { name, namedMembers } of use.protocols) {
    const protocol = findMember(scope.enums.get("Protocol"), name.text);
    if (protocol === undefined) scope.errors.add(name.location, `unknown protocol ${name.text}`);
    else resolved.protocols.push(protocol);
    resolved.namedMembers.push(...namedMembers.map(member => member.text));
  }
}

export function resolveUses(
  scope: Scope,
  uses: readonly UseSyntax[],
  operands: readonly Name[],
  owner: string,
): OperandUses {
  const resolved: MutableUses = {
    uses: [],
    protocols: [],
    namedMembers: [],
    retainedIn: "UnknownMemory",
    retainingOperand: null,
    assignedFromOperand: null,
  };
  for (const use of uses.flatMap(written => scope.namedSets.uses.get(written.name.text) ?? [written])) {
    const { name, operand } = use;
    if (name.text === "runs") {
      addProtocols(scope, resolved, use);
      continue;
    }
    const member = findMember(scope.enums.get("OperandUse"), upperFirst(name.text));
    if (member === undefined) {
      scope.errors.add(name.location, `unknown use ${name.text}`);
      continue;
    }
    resolved.uses.push(member);
    if (operand === null) continue;
    const isRetained = name.text === "retains";
    const index = operands.findIndex(candidate => candidate.text === operand.text);
    if (isRetained && operand.text === "result") {
      resolved.retainedIn = "Result";
    } else if (index < 0) {
      scope.errors.add(operand.location, `${name.text}(${operand.text}) of ${owner} does not name an operand`);
    } else if (isRetained) {
      resolved.retainedIn = "Operand";
      resolved.retainingOperand = index;
    } else {
      resolved.assignedFromOperand = index;
    }
  }
  return resolved;
}

function findForm(scope: Scope, name: Name): Form | null {
  const form = forms.find(candidate => candidate === name.text);
  if (form !== undefined) return form;
  scope.errors.add(name.location, `unknown form ${name.text}`);
  return null;
}

function resolveForms(scope: Scope, range: FormRangeSyntax, owner: string): [Form, Form] {
  const first = findForm(scope, range.first) ?? "AsRead";
  const last = findForm(scope, range.last) ?? "Placed";
  if (forms.indexOf(first) > forms.indexOf(last)) {
    scope.errors.add(range.first.location, `forms of ${owner} are reversed`);
  }
  return [first, last];
}

function expandParameters(
  scope: Scope,
  parameters: readonly ParameterSyntax[],
  declaredGroups: ReadonlySet<string>,
): WrittenParameter[] {
  return parameters.flatMap((parameter): WrittenParameter[] => {
    if (parameter.form !== "Group") return [parameter];
    const { text, location } = parameter.group;
    const group = scope.namedSets.groups.get(text);
    if (group === undefined) scope.errors.add(location, `unknown parameter group ${text}`);
    else if (!declaredGroups.has(text)) scope.errors.add(location, `group ${text} is used before its declaration`);
    else return expandParameters(scope, group, declaredGroups);
    return [];
  });
}

function expandGroup(scope: Scope, syntax: ParameterGroupSyntax, declaredGroups: Set<string>): void {
  const { groups } = scope.namedSets;
  const name = syntax.name.text;
  if (groups.get(name) !== syntax.parameters) return;
  groups.set(name, expandParameters(scope, syntax.parameters, declaredGroups));
  declaredGroups.add(name);
}

function payloadKindNamesOf(kind: Kind): readonly string[] {
  switch (kind.tag) {
    case "Scalar":
      return [kind.scalar];
    case "Id":
      return [kind.id.name];
    case "PlacedWord":
      return [kind.word];
    case "Enum":
    case "Flags":
      return [kind.type.name, kind.tag];
    case "External":
      return [kind.external.name, kind.tag];
    case "Record":
      return [kind.record.name, kind.tag];
    case "Variant":
      return [kind.variant.name, kind.tag];
    case "Span":
    case "List":
      return [kind.tag];
  }
}

function resolvePayloadKind(scope: Scope, kind: Kind, written: KindSyntax): Member {
  const payloadKinds = scope.enums.get("PayloadKind");
  const members = payloadKindNamesOf(kind).flatMap(name => findMember(payloadKinds, name) ?? []);
  if (members.length > 0) return members[0];
  scope.errors.add(written.name.location, `unknown payload kind ${written.name.text}`);
  return createStandInMember(written.name);
}

function resolveOperand(scope: Scope, syntax: OperandSyntax, entry: EntryHead): Operand {
  const kind = findMember(scope.enums.get("OperandKind"), syntax.kind.text);
  if (kind === undefined) scope.errors.add(syntax.kind.location, `unknown operand kind ${syntax.kind.text}`);
  return {
    tag: "Operand",
    name: syntax.name.text,
    index: entry.operands.indexOf(syntax.name),
    kind: kind ?? createStandInMember(syntax.kind),
    uses: resolveUses(scope, syntax.uses, entry.operands, entry.name),
    isOptional: syntax.isOptional,
    isVariadic: syntax.isVariadic,
    isEngine: syntax.isEngine,
    location: syntax.name.location,
  };
}

function resolvePayloadField(scope: Scope, syntax: PayloadSyntax, entry: EntryHead): PayloadField {
  const { name, firstForm } = syntax;
  if (syntax.isVariadic) scope.errors.add(name.location, `payload field ${name.text} of ${entry.name} is variadic`);
  const kind = resolveKind(scope, syntax.kind, "payload");
  const writtenElement = syntax.kind.element;
  return {
    tag: "Payload",
    name: name.text,
    kind,
    payloadKind: resolvePayloadKind(scope, kind, syntax.kind),
    elementPayloadKind:
      kind.tag === "List" && writtenElement !== null ? resolvePayloadKind(scope, kind.element, writtenElement) : null,
    isOptional: syntax.isOptional,
    isEngine: syntax.isEngine,
    firstForm: (firstForm === null ? null : findForm(scope, firstForm)) ?? "AsRead",
    firstWord: null,
    payloadWords: 0,
    location: name.location,
  };
}

function resolveParameter(scope: Scope, syntax: WrittenParameter, entry: EntryHead): Parameter {
  return syntax.form === "Operand" ? resolveOperand(scope, syntax, entry) : resolvePayloadField(scope, syntax, entry);
}

function findColumnKind(scope: Scope, kind: Name): EntryColumnKind | null {
  const plainKind = plainColumnKinds.find(candidate => candidate === kind.text);
  if (plainKind !== undefined) return { tag: plainKind };
  const type = scope.enums.get(kind.text);
  if (type !== undefined) return { tag: type.isFlags ? "Flags" : "Enum", type };
  const elementName = enumSetColumnKinds.get(kind.text);
  const elementType = elementName === undefined ? undefined : scope.enums.get(elementName);
  return elementType === undefined || elementType.isFlags ? null : { tag: "EnumSet", type: elementType };
}

export function resolveEntryColumns(scope: Scope, declarations: readonly DeclarationInFile[]): void {
  for (const { declaration } of declarations) {
    if (declaration.declares !== "column") continue;
    const { name, kind: written } = declaration;
    const kind = findColumnKind(scope, written);
    if (kind === null) scope.errors.add(written.location, `unknown column kind ${written.text} of ${name.text}`);
    else scope.declare(scope.entryColumns, name, { name: name.text, kind, location: name.location });
  }
}

function wordsOf(value: ValueSyntax): readonly Name[] {
  switch (value.form) {
    case "Names":
      return value.names;
    case "Bool":
    case "Integer":
      return [{ text: String(value.value), location: value.location }];
    case "Text":
      return [{ text: `"${value.value}"`, location: value.location }];
  }
}

function findAll<Item extends object>(written: WrittenWords, find: Finder<Item>, description: string): Item[] {
  const { scope, subject, words } = written;
  return words.flatMap(word => {
    const item = find(word.text);
    if (item === undefined) scope.errors.add(word.location, `${subject}: ${word.text} is not ${description}`);
    return item ?? [];
  });
}

function findOnly<Item extends object>(written: WrittenWords, find: Finder<Item>, description: string): Item | null {
  const { scope, subject, words } = written;
  if (words.length > 1) scope.errors.add(words[1].location, `${subject} takes one value`);
  return findAll(written, find, description).at(0) ?? null;
}

function findMembers(written: WrittenWords, type: SchemaEnum): Member[] {
  const { words } = written;
  if (words.length === 1 && words[0].text === "none") return [];
  return findAll(written, name => findMember(type, name), `a member of ${type.name}`);
}

function resolveColumnValue(
  scope: Scope,
  column: EntryColumn,
  values: readonly ValueSyntax[],
  entry: ColumnOwner,
): EntryColumnValue | null {
  const { kind } = column;
  const { parameters } = entry;
  const subject = `${column.name} of ${entry.name}`;
  const written: WrittenWords = { scope, subject, words: values.flatMap(wordsOf) };
  const [value] = values;
  switch (kind.tag) {
    case "Bool":
      if (values.length === 1 && value.form === "Bool") return { tag: "Bool", value: value.value };
      scope.errors.add(value.location, `${subject} is neither true nor false`);
      return null;
    case "UInt32":
      if (values.length === 1 && value.form === "Integer" && value.value >= 0n && value.value <= maximumUInt32) {
        return { tag: "UInt32", value: Number(value.value) };
      }
      scope.errors.add(value.location, `${subject} is not a UInt32`);
      return null;
    case "Operand": {
      const operands = parameters.filter(isOperand);
      const operand = findOnly(written, name => operands.find(candidate => candidate.name === name), "an operand");
      return operand === null ? null : { tag: "Operand", operand };
    }
    case "Parameters": {
      const find = (name: string) => parameters.find(candidate => candidate.name === name);
      return { tag: "Parameters", parameters: findAll(written, find, "a parameter") };
    }
    case "Operations":
      return { tag: "Operations", entries: findAll(written, name => scope.entries.get(name), "an entry") };
    case "RuntimeOperation": {
      const operation = findOnly(written, name => scope.runtimeOperations.get(name), "a runtime operation");
      return operation === null ? null : { tag: "RuntimeOperation", operation };
    }
    case "Enum": {
      const member = findOnly(written, name => findMember(kind.type, name), `a member of ${kind.type.name}`);
      return member === null ? null : { tag: "Member", member };
    }
    case "EnumSet":
    case "Flags":
      return { tag: "Members", members: findMembers(written, kind.type) };
  }
}

function selectKnownColumns(scope: Scope, columns: readonly ColumnValueSyntax[], owner: string): ColumnValueSyntax[] {
  const names = new Set<string>();
  return columns.filter(({ column }) => {
    const isKnown = scope.entryColumns.has(column.text);
    const isRepeated = names.has(column.text);
    if (!isKnown) scope.errors.add(column.location, `unknown column ${column.text}`);
    else if (isRepeated) scope.errors.add(column.location, `${owner} sets ${column.text} twice`);
    names.add(column.text);
    return isKnown && !isRepeated;
  });
}

function writtenColumnsOf(scope: Scope, syntax: EntrySyntax, state: FamilyState): WrittenColumn[] {
  const valuesByName = new Map<string, readonly ValueSyntax[]>();
  const ownColumns = selectKnownColumns(scope, syntax.columns, syntax.name.text);
  for (const { column, values } of [...state.defaults, ...ownColumns]) valuesByName.set(column.text, values);
  return [...valuesByName].flatMap(([name, values]) => {
    const column = scope.entryColumns.get(name);
    return column === undefined ? [] : [{ column, values }];
  });
}

function resolveFlags(syntax: EntrySyntax, columns: ReadonlyMap<string, EntryColumnValue>): Flag[] {
  const runsOwnerBarrier = columns.get("runsOwnerBarrier");
  const hasOwnerBarrier = runsOwnerBarrier?.tag === "Bool" && runsOwnerBarrier.value;
  const impliedNames: readonly string[] = hasOwnerBarrier ? ownerBarrierFlags : [];
  const written = syntax.flags.map(({ name, isEngine }) => ({
    name: name.text,
    isEngine,
    isImplied: false,
    location: name.location,
  }));
  const implied = impliedNames.map(name => ({ name, isEngine: true, isImplied: true, location: syntax.name.location }));
  const flags = [...written, ...implied];
  const wireFirst = [...flags.filter(flag => !flag.isEngine), ...flags.filter(flag => flag.isEngine)];
  return wireFirst.map((flag, bit) => ({ ...flag, bit }));
}

function resolveEffectRule(scope: Scope, rule: Name | null): EffectRuleName {
  if (rule === null) return "Declared";
  const name = effectRules.find(candidate => candidate === rule.text);
  if (name === undefined) scope.errors.add(rule.location, `unknown effect rule ${rule.text}`);
  return name ?? "Declared";
}

function operandNamesInIndexOrder(parameters: readonly WrittenParameter[]): Name[] {
  const operands = parameters.filter((parameter): parameter is OperandSyntax => parameter.form === "Operand");
  const namedOperands = operands.filter(operand => !operand.isVariadic);
  const variadicOperands = operands.filter(operand => operand.isVariadic);
  return [...namedOperands, ...variadicOperands].map(operand => operand.name);
}

function resolveEntry(scope: Scope, syntax: EntrySyntax, state: FamilyState, file: SchemaFile): MutableEntry {
  const name = syntax.name.text;
  const [firstForm, lastForm] = syntax.forms === null ? state.forms : resolveForms(scope, syntax.forms, name);
  const written = expandParameters(scope, syntax.parameters, state.declaredGroups);
  const head: EntryHead = { name, operands: operandNamesInIndexOrder(written) };
  const parameters = written.map(parameter => resolveParameter(scope, parameter, head));
  const operands = parameters.filter(isOperand);
  const payload = parameters.filter(isPayloadField);
  const writtenColumns = writtenColumnsOf(scope, syntax, state);
  const columns = new Map<string, EntryColumnValue>();
  for (const { column, values } of writtenColumns) {
    if (column.kind.tag === "Operations") continue;
    const value = resolveColumnValue(scope, column, values, { name, parameters });
    if (value !== null) columns.set(column.name, value);
  }
  const parts: EntryParts = { name, parameters, columns };
  const entry: MutableEntry = {
    name,
    number: scope.entries.size,
    isTerminator: syntax.declares === "terminator",
    isWire: firstForm === "AsRead" && !syntax.isEngine,
    family: state.family ?? "",
    firstForm,
    lastForm,
    parameters,
    namedOperands: operands.filter(operand => !operand.isVariadic),
    variadicOperand: operands.find(operand => operand.isVariadic) ?? null,
    payload,
    flags: resolveFlags(syntax, columns),
    result: syntax.result === null ? noResult : resolveResult(scope, syntax.result, parts),
    targets: resolveTargets(scope, syntax.targets, parts),
    effects: resolveEffects(scope, syntax.effects, payload, name),
    effectRule: resolveEffectRule(scope, syntax.effects.rule),
    columns,
    file,
    location: syntax.name.location,
  };
  for (const { column, values } of writtenColumns) {
    if (column.kind.tag === "Operations") state.pendingColumns.push({ entry, column, values });
  }
  return entry;
}

function openFamily(scope: Scope, syntax: FamilySyntax, state: FamilyState): void {
  const name = syntax.name.text;
  state.family = name;
  state.forms = resolveForms(scope, syntax.forms, name);
  state.defaults = selectKnownColumns(scope, syntax.defaults, name);
  if (!scope.families.includes(name)) scope.families.push(name);
}

export function resolveEntries(scope: Scope, declarations: readonly DeclarationInFile[]): void {
  const state: FamilyState = {
    family: null,
    forms: ["AsRead", "Placed"],
    defaults: [],
    declaredGroups: new Set(),
    pendingColumns: [],
  };
  for (const { declaration, file } of declarations) {
    if (declaration.declares === "family") {
      openFamily(scope, declaration, state);
    } else if (declaration.declares === "parameters") {
      expandGroup(scope, declaration, state.declaredGroups);
    } else if (declaration.declares === "operation" || declaration.declares === "terminator") {
      const { name } = declaration;
      if (state.family === null) scope.errors.add(name.location, `${name.text} stands before any family header`);
      scope.declare(scope.entries, name, resolveEntry(scope, declaration, state, file));
    }
  }
  for (const { entry, column, values } of state.pendingColumns) {
    const value = resolveColumnValue(scope, column, values, entry);
    if (value !== null) entry.columns.set(column.name, value);
  }
}

export function resolveRuntimeOperations(scope: Scope, declarations: readonly DeclarationInFile[]): void {
  for (const { declaration, file } of declarations) {
    if (declaration.declares !== "runtime") continue;
    const { resultType, isLeaf, preservesMost } = declaration;
    const effects = resolveEffects(scope, declaration.effects, [], declaration.names[0].text);
    const parameters = declaration.parameters.map(({ type, name }) => ({ type, name: name?.text ?? null }));
    for (const name of declaration.names) {
      scope.declare(scope.runtimeOperations, name, {
        name: name.text,
        number: scope.runtimeOperations.size,
        resultType,
        parameters,
        effects,
        isLeaf,
        preservesMost,
        file,
        location: name.location,
      });
    }
  }
}

function resolveInlineParameterKind(scope: Scope, kind: Name, owner: string): Kind {
  const found = findKind(scope, kind.text, "payload");
  if (found !== null) return found;
  scope.errors.add(kind.location, `unknown parameter kind ${kind.text} of inline ${owner}`);
  return { tag: "Scalar", scalar: "UInt32" };
}

export function resolveInlineBuiltins(scope: Scope, declarations: readonly DeclarationInFile[]): void {
  for (const { declaration } of declarations) {
    if (declaration.declares !== "inline") continue;
    const family = declaration.family.text;
    if (!scope.inlineFamilies.includes(family)) scope.inlineFamilies.push(family);
    const effects = resolveEffects(scope, declaration.effects, [], declaration.entries[0].name.text);
    for (const { name, parameterKinds } of declaration.entries) {
      scope.declare(scope.inlineBuiltins, name, {
        name: name.text,
        number: scope.inlineBuiltins.size,
        parameterKinds: parameterKinds.map(kind => resolveInlineParameterKind(scope, kind, name.text)),
        effects,
        family,
        hasOptionalSlowPath: declaration.hasOptionalSlowPath,
        isFormOnly: declaration.isFormOnly,
        location: name.location,
      });
    }
  }
}

export function assignPayloadWords(scope: Scope): void {
  for (const entry of scope.entries.values()) {
    const payload: readonly Mutable<PayloadField>[] = entry.payload;
    let nextWord = 0;
    for (const field of payload) {
      field.payloadWords = payloadWordsOf(field.kind);
      field.firstWord = field.kind.tag === "List" ? null : nextWord;
      nextWord += field.payloadWords;
    }
  }
}
