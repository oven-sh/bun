import type { ModelBuilder, MutableBuiltin } from "./build-entries.ts";
import type { TypeInterner } from "./build-types.ts";
import type { Declaration, HostReadUse, Source } from "./declarations.ts";
import { addFlag } from "./model-builder.ts";
import type {
  ModelAttachments,
  ModelBuiltin,
  ModelCalledFunction,
  ModelCondition,
  ModelExportRead,
  ModelFeatureUse,
  ModelFunction,
  ModelHostCall,
  ModelHostMethodCall,
  ModelHostObject,
  ModelHostRead,
  ModelHostUse,
  ModelHostUses,
  ModelHostValue,
  ModelModule,
  ModelModuleLoad,
  ModelName,
  ModelNamedMemberCall,
  ModelNativeFunction,
  ModelOperand,
  ModelOverload,
  ModelStartup,
  ModelType,
  TableFeature,
} from "./model.ts";
import { compareBytes, joinPath, pathOfNativeBinding, tokenOf } from "./paths.ts";
import {
  hostReadContexts,
  type BoxedStubName,
  type BuiltinPath,
  type CalledFunctionSpec,
  type ConditionSpec,
  type EntryColumns,
  type FeatureName,
  type FeatureUseSpec,
  type FunctionRef,
  type HostCallSpec,
  type HostUseSpec,
  type HostValueSpec,
  type ModuleLoadSpec,
  type NativeCodeRef,
  type OperandName,
} from "./vocabulary.ts";

const textFormRoot = "%JSONText%";
const objectColumns = [
  "usesFeature",
  "runsUnseenCode",
  "loads",
  "callsFunctions",
  "appendForm",
  "hostAppendSymbol",
  "jsonTextForm",
  "literalPartsForm",
  "bodyBytesForm",
  "boxedCallStub",
] as const satisfies readonly (keyof EntryColumns)[];

interface Written<T> {
  value: T;
  source: Source;
}

// A site in native code says that it reads an export and nothing more: the row for the same export says what becomes of it.
type WrittenHostUses = ModelHostUses | "Unsaid";

interface WrittenExportRead {
  name: ModelName;
  uses: WrittenHostUses;
}

interface WrittenModuleLoad extends Omit<ModelModuleLoad, "exports"> {
  exports: readonly WrittenExportRead[] | null;
}

interface NativeLoads {
  byBuiltin: ReadonlyMap<ModelBuiltin, readonly WrittenModuleLoad[]>;
  atStartup: readonly WrittenModuleLoad[];
}

interface TextForm {
  builtin: MutableBuiltin;
  nativeFunction: ModelNativeFunction;
}

// BuiltinForms::literalPartNames has room for as many.
const maxLiteralPartNames = 4;

type NativeCalls = ReadonlyMap<ModelBuiltin, readonly Written<readonly CalledFunctionSpec[]>[]>;

interface AttachmentContext {
  builder: ModelBuilder;
  types: TypeInterner;
  featureNames: ReadonlySet<FeatureName>;
  nativeLoads: NativeLoads;
  nativeCalls: NativeCalls;
  textForms: Map<ModelBuiltin, TextForm>;
}

interface SeenCode {
  holders: ReadonlySet<ModelBuiltin>;
  nativeFiles: ReadonlySet<string>;
  bindingFiles: ReadonlyMap<ModelBuiltin, string>;
}

type DeclarationOf<K extends Declaration["declares"]> = Extract<Declaration, { declares: K }>;
type TextFormSpec = NonNullable<EntryColumns["jsonTextForm"]>;

const compareIds = (left: { id: number }, right: { id: number }) => left.id - right.id;
const compareNames = (left: ModelName, right: ModelName) => compareBytes(left.text, right.text);
const textFormPathOf = (builtin: ModelBuiltin): BuiltinPath => joinPath([textFormRoot, tokenOf(builtin.path)]);

function declarationsOf<K extends Declaration["declares"]>(
  builder: ModelBuilder,
  kind: K,
): Written<DeclarationOf<K>>[] {
  return builder.declarations.flatMap(({ declaration, source }) =>
    declaration.declares === kind ? [{ value: declaration as DeclarationOf<K>, source }] : [],
  );
}

function writtenColumn<K extends keyof EntryColumns>(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  key: K,
): Written<NonNullable<EntryColumns[K]>>[] {
  return builder.columnsOf(builtin).flatMap(({ columns, source }) => {
    const value = columns[key];
    return value === undefined ? [] : [{ value: value as NonNullable<EntryColumns[K]>, source }];
  });
}

function resolveObject(builder: ModelBuilder, path: BuiltinPath, source: Source): ModelBuiltin | null {
  const builtin = builder.resolve(path, source);
  return builtin === null ? null : (builtin.sameObjectAs ?? builtin);
}

function internTexts(builder: ModelBuilder, texts: readonly string[]): ModelName[] {
  return [...new Set(texts)].sort(compareBytes).map(text => builder.internName(text, "Text"));
}

function callOverloadsOf(builtin: ModelBuiltin): ModelOverload[] {
  return builtin.overloads.filter(
    overload => (overload.mode === "Call" || overload.mode === "Construct") && !overload.flags.includes("IsUndeclared"),
  );
}

const runsOtherCode = ({ effects, flags }: ModelOverload): boolean =>
  effects.capability === "js" && !flags.includes("RunsOnlyOperandCode");

function resolveOperand(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  name: OperandName,
  source: Source,
): ModelOperand | null {
  const overloads = callOverloadsOf(builtin);
  if (name === "this") {
    if (overloads.some(overload => overload.receiver !== null)) return { operand: "Receiver" };
    builder.problems.add(source, `${builtin.text} has no overload with a receiver`);
    return null;
  }
  const positions = overloads.map(overload => overload.parameters.findIndex(parameter => parameter.name === name));
  const first = positions.findIndex(position => position >= 0);
  if (first < 0) {
    builder.problems.add(source, `${builtin.text} has no parameter named ${name}`);
    return null;
  }
  const position = positions[first];
  const { operand } = overloads[first].parameters[position];
  let isConsistent = true;
  for (const [index, overload] of overloads.entries()) {
    if (positions[index] < 0 && overload.parameters.length <= position) continue;
    if (positions[index] === position && overload.parameters[position].operand.operand === operand.operand) continue;
    builder.problems.add(
      source,
      `${builtin.text}: ${name} is parameter ${position} of one overload and not of overload ${builtin.overloads.indexOf(overload)}`,
    );
    isConsistent = false;
  }
  return isConsistent ? operand : null;
}

const conditionOnNoOperand: ModelCondition = {
  operand: null,
  isOneOf: [],
  startsWith: [],
  calledOn: null,
  hasProperty: null,
  buildAdmitsRuntimeCode: false,
  callRunsOtherCode: false,
  objectNobodyKnowsIsWritten: false,
};

function resolveConditionOnOverload(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  source: Source,
): ModelCondition | null {
  if (builtin.overloads.some(runsOtherCode)) return { ...conditionOnNoOperand, callRunsOtherCode: true };
  builder.problems.add(source, `${builtin.text} has no overload that runs JavaScript which no operand names`);
  return null;
}

export function resolveCondition(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  condition: ConditionSpec,
  source: Source,
): ModelCondition | null {
  if ("buildAdmitsRuntimeCode" in condition) return { ...conditionOnNoOperand, buildAdmitsRuntimeCode: true };
  if ("objectNobodyKnowsIsWritten" in condition) {
    builder.problems.add(
      source,
      `${builtin.text}: only loads and callsFunctions can depend on the stores of the program`,
    );
    return null;
  }
  if ("callRunsOtherCode" in condition) {
    builder.problems.add(
      source,
      `${builtin.text}: only loads and callsFunctions can depend on the overload that takes the call`,
    );
    return null;
  }
  const operand = resolveOperand(builder, builtin, condition.operand, source);
  if (operand === null) return null;
  if ("hasProperty" in condition) {
    return { ...conditionOnNoOperand, operand, hasProperty: builder.internComponent(condition.hasProperty) };
  }
  const calledOn = condition.calledOn === undefined ? null : resolveObject(builder, condition.calledOn, source);
  if (condition.calledOn !== undefined && calledOn === null) return null;
  return {
    ...conditionOnNoOperand,
    operand,
    isOneOf: internTexts(builder, condition.isOneOf),
    startsWith: internTexts(builder, condition.startsWith),
    calledOn,
  };
}

function resolveDependencyCondition(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  condition: ConditionSpec,
  source: Source,
): ModelCondition | null {
  if ("callRunsOtherCode" in condition) return resolveConditionOnOverload(builder, builtin, source);
  if ("objectNobodyKnowsIsWritten" in condition) return { ...conditionOnNoOperand, objectNobodyKnowsIsWritten: true };
  return resolveCondition(builder, builtin, condition, source);
}

function featureUseSpecsOf(written: FeatureUseSpec | readonly FeatureUseSpec[] | undefined): readonly FeatureUseSpec[] {
  if (written === undefined) return [];
  return typeof written === "string" || "feature" in written ? [written] : written;
}

function resolveFeatureUse(
  context: AttachmentContext,
  builtin: ModelBuiltin,
  overload: ModelOverload | null,
  spec: FeatureUseSpec,
  source: Source,
): ModelFeatureUse | null {
  const { builder, featureNames } = context;
  const feature = typeof spec === "string" ? spec : spec.feature;
  if (!featureNames.has(feature)) {
    builder.problems.add(
      source,
      `${builtin.text} uses the feature ${feature}, which src/trim/features does not declare`,
    );
    return null;
  }
  if (typeof spec === "string") return { feature, overload, isGuard: false, condition: null };
  const condition = resolveCondition(builder, builtin, spec.when, source);
  return condition === null ? null : { feature, overload, isGuard: false, condition };
}

function buildFeatureUses(context: AttachmentContext, builtin: ModelBuiltin): ModelFeatureUse[] {
  const { builder } = context;
  const written: { overload: ModelOverload | null; spec: FeatureUseSpec; source: Source }[] = [];
  for (const { value, source } of writtenColumn(builder, builtin, "usesFeature")) {
    for (const spec of featureUseSpecsOf(value)) written.push({ overload: null, spec, source });
  }
  for (const overload of builtin.overloads) {
    for (const spec of featureUseSpecsOf(builder.signatureOf(overload)?.overloadUsesFeature)) {
      written.push({ overload, spec, source: overload.source });
    }
  }
  const uses: ModelFeatureUse[] = [];
  for (const { overload, spec, source } of written) {
    const use = resolveFeatureUse(context, builtin, overload, spec, source);
    if (use === null) continue;
    // Lines with different conditions are alternatives: the feature is used where one of them holds.
    const repeats = (other: ModelFeatureUse) =>
      other.feature === use.feature &&
      other.overload === overload &&
      (other.condition === null ||
        use.condition === null ||
        describeCondition(other.condition) === describeCondition(use.condition));
    if (uses.some(repeats)) {
      builder.problems.add(source, `${builtin.text} uses the feature ${use.feature} twice`);
      continue;
    }
    uses.push(use);
  }
  const guard = uses.findIndex(use => use.condition === null && use.overload === null);
  return uses.map((use, index) => ({ ...use, isGuard: index === guard }));
}

function withoutConditions(uses: readonly ModelFeatureUse[]): ModelFeatureUse[] {
  const unconditional = uses.filter(use => use.condition === null && use.overload === null);
  const features = new Set([...unconditional, ...uses].map(use => use.feature));
  return [...features].map((feature, index) => ({ feature, overload: null, isGuard: index === 0, condition: null }));
}

function findHolderFeatureUses(builder: ModelBuilder, builtin: ModelBuiltin): readonly ModelFeatureUse[] {
  for (let owner = builtin; owner.holder !== null; owner = owner.holder) {
    const { holder } = owner;
    const isCovered =
      holder.kind !== "Prototype" ||
      (holder.holder !== null &&
        writtenColumn(builder, holder.holder, "prototypeUsesFeature").some(({ value }) => value));
    if (!isCovered) return [];
    if (holder.attachments.featureUses.length > 0) return holder.attachments.featureUses;
  }
  return [];
}

const isPrimitive = ({ isAnything, hasAnyObject, hasAnyFunction, hasPlainData, parts }: ModelType): boolean =>
  !isAnything && !hasAnyObject && !hasAnyFunction && !hasPlainData && parts.length === 0;

function holdsOnlyPrimitives({ kind, flags, overloads }: ModelBuiltin): boolean {
  if (kind === "Constant") return true;
  if (kind !== "DataProperty" || flags.includes("IsLazilyCreated") || overloads.length === 0) return false;
  return overloads.every(({ mode, result }) => mode === "Get" && isPrimitive(result.type));
}

function inheritFeatureUses(context: AttachmentContext): void {
  const inherited: [MutableBuiltin, ModelFeatureUse[]][] = [];
  for (const builtin of context.builder.builtins) {
    if (builtin.sameObjectAs !== null || writtenColumn(context.builder, builtin, "usesFeature").length > 0) continue;
    if (builtin.attachments.featureUses.length > 0 || holdsOnlyPrimitives(builtin)) continue;
    const holderUses = findHolderFeatureUses(context.builder, builtin);
    if (holderUses.length > 0) inherited.push([builtin, withoutConditions(holderUses)]);
  }
  for (const [builtin, featureUses] of inherited) builtin.attachments = { ...builtin.attachments, featureUses };
}

function describeHostValue(value: ModelHostValue): string {
  switch (value.place) {
    case "None":
    case "NativeMemory":
      return value.place;
    case "NewValue":
      return `NewValue ${value.type.key}`;
    case "NativeCell":
      return `NativeCell ${value.cell.text}`;
  }
}

const describeHostUses = (uses: ModelHostUses): unknown => uses?.map(describeHostUse) ?? null;

const describeHostCall = ({ times, thisValue, arguments: passed, otherArguments, result }: ModelHostCall): unknown => [
  times,
  describeHostValue(thisValue),
  passed?.map(describeHostValue) ?? null,
  describeHostValue(otherArguments),
  describeHostUses(result),
];

function describeHostUse(use: ModelHostUse): string {
  const path = use.path.map(name => [name.kind, name.text]);
  switch (use.read) {
    case "Inspected":
      return JSON.stringify([path, use.read]);
    case "Called":
      return JSON.stringify([path, use.read, use.call === null ? null : describeHostCall(use.call)]);
    case "PassedTo":
      return JSON.stringify([path, use.read, use.builtin.text, use.argument]);
    case "Kept":
      return JSON.stringify([path, use.read, use.cell.text]);
    case "IsValueOf":
      return JSON.stringify([path, use.read, use.builtin.text]);
  }
}

// Rows add up, and one that does not say what native code does leaves it open.
function mergeHostUses(left: ModelHostUses, right: ModelHostUses): ModelHostUses {
  if (left === null || right === null) return null;
  const seen = new Set(left.map(describeHostUse));
  return [...left, ...right.filter(use => !seen.has(describeHostUse(use)))];
}

function mergeWrittenHostUses(left: WrittenHostUses, right: WrittenHostUses): WrittenHostUses {
  if (left === "Unsaid") return right;
  return right === "Unsaid" ? left : mergeHostUses(left, right);
}

function mergeExports(
  left: readonly WrittenExportRead[] | null,
  right: readonly WrittenExportRead[] | null,
): WrittenExportRead[] | null {
  if (left === null || right === null) return null;
  const reads = new Map<ModelName, WrittenHostUses>();
  for (const { name, uses } of [...left, ...right])
    reads.set(name, mergeWrittenHostUses(reads.get(name) ?? "Unsaid", uses));
  return Array.from(reads, ([name, uses]) => ({ name, uses })).sort((first, second) =>
    compareNames(first.name, second.name),
  );
}

const readsAtNativeSite = (builder: ModelBuilder, texts: readonly string[]): WrittenExportRead[] =>
  internTexts(builder, texts).map(name => ({ name, uses: "Unsaid" }));

const finishExportRead = ({ name, uses }: WrittenExportRead): ModelExportRead => ({
  name,
  uses: uses === "Unsaid" ? null : uses,
});

const noHostValue: ModelHostValue = { place: "None" };

function resolveHostValue({ builder, types }: AttachmentContext, spec: HostValueSpec, source: Source): ModelHostValue {
  switch (spec.place) {
    case "NewValue":
      return { place: "NewValue", type: types.intern(spec.value, null, source) };
    case "NativeCell":
      return { place: "NativeCell", cell: builder.internName(spec.cell, "Text") };
    case "NativeMemory":
      return { place: "NativeMemory" };
  }
}

function resolveHostCall(context: AttachmentContext, spec: HostCallSpec, source: Source): ModelHostCall | null {
  const result = spec.result === undefined ? null : resolveHostUses(context, spec.result, source);
  if (spec.result !== undefined && result === null) return null;
  const valueOf = (value: HostValueSpec | undefined) =>
    value === undefined ? noHostValue : resolveHostValue(context, value, source);
  return {
    times: spec.times,
    thisValue: valueOf(spec.thisValue),
    arguments: spec.arguments?.map(valueOf) ?? null,
    otherArguments: valueOf(spec.otherArguments),
    result,
  };
}

function resolveHostUse(
  context: AttachmentContext,
  spec: HostUseSpec,
  path: readonly ModelName[],
  source: Source,
): ModelHostUse[] | null {
  const { builder } = context;
  switch (spec.read) {
    case "Inspected":
      return [{ path, read: "Inspected" }];
    case "Kept":
      return [{ path, read: "Kept", cell: builder.internName(spec.cell, "Text") }];
    case "Called": {
      const call = spec.call === undefined ? null : resolveHostCall(context, spec.call, source);
      return spec.call !== undefined && call === null ? null : [{ path, read: "Called", call }];
    }
    case "PassedTo": {
      const builtin = resolveObject(builder, spec.builtin, source);
      return builtin === null ? null : [{ path, read: "PassedTo", builtin, argument: spec.argument }];
    }
    case "IsValueOf": {
      const builtin = resolveObject(builder, spec.builtin, source);
      return builtin === null ? null : [{ path, read: "IsValueOf", builtin }];
    }
    case "Member":
      return resolveHostUsesAt(context, spec.uses, [...path, builder.internComponent(String(spec.name))], source);
  }
}

function resolveHostUsesAt(
  context: AttachmentContext,
  specs: readonly HostUseSpec[],
  path: readonly ModelName[],
  source: Source,
): ModelHostUse[] | null {
  const resolved = specs.map(spec => resolveHostUse(context, spec, path, source));
  return resolved.includes(null) ? null : resolved.flatMap(uses => uses ?? []);
}

// null: a reference did not resolve, and the problem is reported.
function resolveHostUses(
  context: AttachmentContext,
  specs: readonly HostUseSpec[],
  source: Source,
): ModelHostUse[] | null {
  return resolveHostUsesAt(context, specs, [], source);
}

function resolveExportReads(
  context: AttachmentContext,
  specs: NonNullable<ModuleLoadSpec["exports"]>,
  source: Source,
): WrittenExportRead[] | null {
  let reads: WrittenExportRead[] | null = [];
  for (const spec of specs) {
    const name = context.builder.internName(typeof spec === "string" ? spec : spec.name, "Text");
    const uses = typeof spec === "string" ? null : resolveHostUses(context, spec.uses, source);
    if (typeof spec !== "string" && uses === null) return null;
    reads = mergeExports(reads, [{ name, uses }]);
  }
  return reads;
}

function mergeModuleLoads(loads: readonly WrittenModuleLoad[]): ModelModuleLoad[] {
  const unconditional = new Map<ModelModule, WrittenModuleLoad>();
  const conditional: WrittenModuleLoad[] = [];
  for (const load of loads) {
    if (load.condition !== null) {
      conditional.push(load);
      continue;
    }
    const previous = unconditional.get(load.module);
    const exports = previous === undefined ? load.exports : mergeExports(previous.exports, load.exports);
    unconditional.set(load.module, { ...load, exports });
  }
  return [...unconditional.values(), ...conditional]
    .map(load => ({ ...load, exports: load.exports?.map(finishExportRead) ?? null }))
    .sort((left, right) => compareIds(left.module, right.module));
}

function collectNativeLoads(builder: ModelBuilder): NativeLoads {
  const modulesByField = new Map<string, ModelModule>();
  for (const { value: declared, source } of declarationsOf(builder, "Module")) {
    if (declared.registryField === null) continue;
    const module = builder.resolveModule(declared.specifier, source);
    if (module !== null) modulesByField.set(declared.registryField, module);
  }
  const byBuiltin = new Map<ModelBuiltin, WrittenModuleLoad[]>();
  const atStartup: WrittenModuleLoad[] = [];
  for (const { value: load, source } of declarationsOf(builder, "NativeLoad")) {
    const module = modulesByField.get(load.registryField);
    if (module === undefined) {
      builder.reportUnknown(source, `InternalModuleRegistry has no field ${load.registryField}`);
      continue;
    }
    const exports = load.exports === null ? null : readsAtNativeSite(builder, load.exports);
    if (load.onBehalfOf === "Startup") {
      atStartup.push({ module, exports, condition: null });
      continue;
    }
    const builtin = resolveObject(builder, load.onBehalfOf, source);
    if (builtin === null) continue;
    byBuiltin.set(builtin, [...(byBuiltin.get(builtin) ?? []), { module, exports, condition: null }]);
  }
  return { byBuiltin, atStartup };
}

function buildModuleLoads(context: AttachmentContext, builtin: ModelBuiltin): ModelModuleLoad[] {
  const { builder, nativeLoads } = context;
  const loads = [...(nativeLoads.byBuiltin.get(builder.bindingsOfFunctions.get(builtin) ?? builtin) ?? [])];
  for (const { value, source } of writtenColumn(builder, builtin, "loads")) {
    for (const spec of value) {
      const module = builder.resolveModule(spec.module, source);
      const condition =
        spec.when === undefined ? null : resolveDependencyCondition(builder, builtin, spec.when, source);
      if (module === null || (spec.when !== undefined && condition === null)) continue;
      const exports = spec.exports === undefined ? null : resolveExportReads(context, spec.exports, source);
      if (spec.exports !== undefined && exports === null) continue;
      loads.push({ module, exports, condition });
    }
  }
  return mergeModuleLoads(loads);
}

const calledFunctionOf = (spec: CalledFunctionSpec): Exclude<CalledFunctionSpec, FunctionRef> =>
  "function" in spec ? spec : { function: spec };

function collectNativeCalls(builder: ModelBuilder): NativeCalls {
  const byBuiltin = new Map<ModelBuiltin, Written<readonly CalledFunctionSpec[]>[]>();
  for (const { value: declared, source } of declarationsOf(builder, "NativeCalls")) {
    for (const { onBehalfOf, calls = declared.calls } of declared.callers) {
      for (const entry of onBehalfOf) {
        const builtin = resolveObject(builder, typeof entry === "string" ? entry : entry.path, source);
        if (builtin === null) continue;
        const value =
          typeof entry === "string" ? calls : calls.map(called => ({ ...calledFunctionOf(called), when: entry.when }));
        byBuiltin.set(builtin, [...(byBuiltin.get(builtin) ?? []), { value, source }]);
      }
    }
  }
  return byBuiltin;
}

const describeCondition = ({ operand, isOneOf, startsWith, calledOn, hasProperty, ...flags }: ModelCondition): string =>
  JSON.stringify([
    operand,
    isOneOf.map(name => name.text),
    startsWith.map(name => name.text),
    calledOn === null ? null : calledOn.id,
    hasProperty === null ? null : [hasProperty.kind, hasProperty.text],
    flags,
  ]);

function addCalledFunction(records: Map<string, ModelCalledFunction>, called: ModelCalledFunction): void {
  const key = `${called.function.id} ${called.condition === null ? "" : describeCondition(called.condition)}`;
  const previous = records.get(key);
  records.set(key, previous === undefined ? called : { ...called, uses: mergeHostUses(previous.uses, called.uses) });
}

function buildCalledFunctions(context: AttachmentContext, builtin: ModelBuiltin): ModelCalledFunction[] {
  const { builder, nativeCalls } = context;
  const records = new Map<string, ModelCalledFunction>();
  const calledFor = builder.bindingsOfFunctions.get(builtin) ?? builtin;
  const written = [...writtenColumn(builder, builtin, "callsFunctions"), ...(nativeCalls.get(calledFor) ?? [])];
  for (const { value, source } of written) {
    for (const spec of value.map(calledFunctionOf)) {
      const called = builder.resolveFunction(spec.function, source);
      const condition =
        spec.when === undefined ? null : resolveDependencyCondition(builder, builtin, spec.when, source);
      const uses = spec.uses === undefined ? null : resolveHostUses(context, spec.uses, source);
      if (called === null || (spec.when !== undefined && condition === null)) continue;
      if (spec.uses !== undefined && uses === null) continue;
      addCalledFunction(records, { function: called, condition, uses });
    }
  }
  const unconditional = new Map<ModelFunction, ModelCalledFunction>();
  for (const record of records.values()) {
    if (record.condition === null) unconditional.set(record.function, record);
  }
  // What holds without a condition holds with one, so the record without one takes in what the others say.
  for (const record of records.values()) {
    const general = unconditional.get(record.function);
    if (general === undefined || general === record) continue;
    unconditional.set(record.function, { ...general, uses: mergeHostUses(general.uses, record.uses) });
  }
  return [
    ...unconditional.values(),
    ...[...records.values()].filter(called => !unconditional.has(called.function)),
  ].sort((left, right) => compareIds(left.function, right.function));
}

export function createTextForms(builder: ModelBuilder): void {
  for (const builtin of [...builder.builtins]) {
    if (builtin.sameObjectAs !== null) continue;
    for (const { value: form, source } of writtenColumn(builder, builtin, "jsonTextForm")) {
      if (form.nativeSymbol === undefined || form.path !== undefined) continue;
      builder.createHiddenFunction(textFormPathOf(builtin), builtin, source);
    }
  }
}

function resolveCreatedTextForm(
  context: AttachmentContext,
  builtin: ModelBuiltin,
  symbol: string,
  source: Source,
): ModelBuiltin | null {
  const { builder, textForms } = context;
  const textForm = builder.resolve(textFormPathOf(builtin), source);
  if (textForm === null) return null;
  const nativeFunction = { symbol, length: builder.lengthOf(builtin) ?? 0, header: null };
  textForms.set(builtin, { builtin: textForm, nativeFunction });
  return textForm;
}

function findTextForm(
  context: AttachmentContext,
  builtin: ModelBuiltin,
  { value: form, source }: Written<TextFormSpec>,
): ModelBuiltin | null {
  const { nativeSymbol, path } = form;
  if (nativeSymbol !== undefined && path === undefined) {
    return resolveCreatedTextForm(context, builtin, nativeSymbol, source);
  }
  if (path !== undefined && nativeSymbol === undefined) return resolveObject(context.builder, path, source);
  context.builder.problems.add(source, `${builtin.text}: jsonTextForm takes either a native symbol or a path`);
  return null;
}

function finishTextForms(context: AttachmentContext): void {
  for (const [builtin, { builtin: textForm, nativeFunction }] of context.textForms) {
    textForm.attachments = {
      ...textForm.attachments,
      featureUses: builtin.attachments.featureUses.filter(use => use.overload === null),
      nativeFunction,
      nativeSymbols: [nativeFunction.symbol],
    };
  }
}

function resolveTextArgument(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  { value: form, source }: Written<TextFormSpec>,
): ModelOperand | null {
  const { argument } = form;
  if (typeof argument !== "number") return resolveOperand(builder, builtin, argument, source);
  if (Number.isInteger(argument) && argument >= 0) return { operand: "Argument", index: argument };
  builder.problems.add(source, `${builtin.text}: the argument of jsonTextForm is a parameter's name or its index`);
  return null;
}

function buildTextForm(context: AttachmentContext, builtin: ModelBuiltin): ModelAttachments["jsonTextForm"] {
  const [written] = writtenColumn(context.builder, builtin, "jsonTextForm");
  if (written === undefined) return null;
  const argument = resolveTextArgument(context.builder, builtin, written);
  if (argument === null) return null;
  const textForm = findTextForm(context, builtin, written);
  return textForm === null ? null : { argument, builtin: textForm };
}

function buildLiteralPartsForm(
  context: AttachmentContext,
  builtin: ModelBuiltin,
): ModelAttachments["literalPartsForm"] {
  const { builder } = context;
  const [written] = writtenColumn(builder, builtin, "literalPartsForm");
  if (written === undefined) return null;
  const { argument, names, path } = written.value;
  if (!Number.isInteger(argument) || argument < 0 || names.length === 0 || names.length > maxLiteralPartNames) {
    builder.problems.add(
      written.source,
      `${builtin.text}: literalPartsForm takes the index of an argument and 1 to ${maxLiteralPartNames} names`,
    );
    return null;
  }
  const form = resolveObject(builder, path, written.source);
  if (form === null) return null;
  return {
    argument: { operand: "Argument", index: argument },
    names: names.map(name => builder.internName(name, "Text")),
    builtin: form,
  };
}

// The form is linked into an executable exactly when the entry that it stands in for is.
function finishLiteralPartsForms({ builder }: AttachmentContext): void {
  for (const builtin of builder.builtins) {
    const { literalPartsForm, featureUses } = builtin.attachments;
    const form = builder.builtins.find(candidate => candidate === literalPartsForm?.builtin);
    if (form === undefined) continue;
    form.attachments = { ...form.attachments, featureUses: featureUses.filter(use => use.overload === null) };
  }
}

function findStubFunction(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  stub: Written<BoxedStubName>,
  nativeSymbols: readonly string[],
): ModelNativeFunction | null {
  const length = builder.lengthOf(builtin);
  if (nativeSymbols.length !== 1) {
    builder.problems.add(
      stub.source,
      `${builtin.text} has the boxed call stub ${stub.value} and ${nativeSymbols.length} native symbols: the stub is installed for the one native function of an entry`,
    );
    return null;
  }
  if (length === null) {
    builder.problems.add(
      stub.source,
      `${builtin.text} has the boxed call stub ${stub.value}, and neither a static table nor the column length says the length of its function`,
    );
    return null;
  }
  return { symbol: nativeSymbols[0], length, header: null };
}

function findFunctionObjectCode(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  { value: { symbol, header }, source }: Written<NativeCodeRef>,
): ModelNativeFunction | null {
  // What is written for a native binding describes the function that it makes, which has an entry of its own.
  if (builtin.kind === "NativeBinding") return null;
  const length = builder.lengthOf(builtin);
  if (length !== null) return { symbol, length, header: header ?? null };
  builder.problems.add(
    source,
    `${builtin.text} names the native code of its function object and not the length of that function`,
  );
  return null;
}

function findNativeFunction(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  nativeSymbols: readonly string[],
): ModelNativeFunction | null {
  const [boxedCallStub] = writtenColumn(builder, builtin, "boxedCallStub");
  const [functionObjectCode] = writtenColumn(builder, builtin, "functionObjectCode");
  if (boxedCallStub !== undefined) return findStubFunction(builder, builtin, boxedCallStub, nativeSymbols);
  return functionObjectCode === undefined ? null : findFunctionObjectCode(builder, builtin, functionObjectCode);
}

function buildEntryAttachments(context: AttachmentContext, builtin: ModelBuiltin): ModelAttachments {
  const { builder } = context;
  const nativeSymbols = writtenColumn(builder, builtin, "nativeSymbols").flatMap(({ value }) => value);
  const [appendForm] = writtenColumn(builder, builtin, "appendForm");
  const [hostAppendSymbol] = writtenColumn(builder, builtin, "hostAppendSymbol");
  const [bodyBytesForm] = writtenColumn(builder, builtin, "bodyBytesForm");
  const [boxedCallStub] = writtenColumn(builder, builtin, "boxedCallStub");
  const [creationSymbol] = writtenColumn(builder, builtin, "creationSymbol");
  const [linkTimeConstant] = writtenColumn(builder, builtin, "linkTimeConstant");
  return {
    featureUses: buildFeatureUses(context, builtin),
    unseenCodeCondition: null,
    moduleLoads: buildModuleLoads(context, builtin),
    calledFunctions: buildCalledFunctions(context, builtin),
    appendForm: appendForm?.value ?? null,
    hostAppendSymbol: hostAppendSymbol?.value ?? null,
    jsonTextForm: buildTextForm(context, builtin),
    literalPartsForm: buildLiteralPartsForm(context, builtin),
    bodyBytesForm:
      bodyBytesForm === undefined ? null : resolveObject(builder, bodyBytesForm.value, bodyBytesForm.source),
    boxedCallStub: boxedCallStub?.value ?? null,
    nativeFunction: findNativeFunction(builder, builtin, nativeSymbols),
    nativeSymbols,
    creationSymbol: creationSymbol?.value ?? null,
    linkTimeConstant: linkTimeConstant?.value ?? null,
  };
}

function checkAliasColumns(builder: ModelBuilder, alias: ModelBuiltin, original: ModelBuiltin): void {
  for (const { columns, source } of builder.columnsOf(alias)) {
    const written = objectColumns.filter(column => columns[column] !== undefined);
    if (written.length === 0) continue;
    builder.problems.add(
      source,
      `${alias.text} is the same object as ${original.text}: write ${written.join(", ")} on ${original.text}`,
    );
  }
}

function collectBoxedStubs(builder: ModelBuilder): BoxedStubName[] {
  const stubs = new Set(builder.builtins.flatMap(builtin => builtin.attachments.boxedCallStub ?? []));
  return [...stubs].sort(compareBytes);
}

function resolveHostReadUse(builder: ModelBuilder, use: HostReadUse, source: Source): ModelHostRead["use"] | null {
  switch (use.read) {
    case "Inspected":
    case "Called":
      return use;
    case "PassedTo": {
      const builtin = resolveObject(builder, use.builtin, source);
      return builtin === null ? null : { read: "PassedTo", builtin, argument: use.argument };
    }
  }
}

function buildHostReads(builder: ModelBuilder): ModelHostRead[] {
  const reads: ModelHostRead[] = [];
  for (const { value: read, source } of declarationsOf(builder, "HostRead")) {
    const use = resolveHostReadUse(builder, read.use, source);
    if (use === null) continue;
    reads.push({ context: read.context, exportName: builder.internName(read.exportName, "Text"), use });
  }
  const rankOf = (read: ModelHostRead) => hostReadContexts.indexOf(read.context);
  return reads.sort((left, right) => rankOf(left) - rankOf(right) || compareNames(left.exportName, right.exportName));
}

function buildStartup(context: AttachmentContext): ModelStartup {
  const { builder } = context;
  const nativeLoads = context.nativeLoads.atStartup;
  const modules = new Set<ModelModule>();
  const loads = [...nativeLoads];
  const functionsCalledWithLoads = new Map<ModelFunction, ModelCalledFunction>();
  const namesOfMethodsCallingLoads = new Set<ModelName>();
  const moduleLoaderFunctions = new Set<ModelFunction>();
  for (const { value: startup, source } of declarationsOf(builder, "Startup")) {
    for (const name of startup.namesOfMethodsCallingLoads)
      namesOfMethodsCallingLoads.add(builder.internComponent(name));
    for (const specifier of startup.modules) {
      const module = builder.resolveModule(specifier, source);
      if (module === null) continue;
      if (modules.has(module)) builder.problems.add(source, `${specifier} is listed as a start-up module twice`);
      modules.add(module);
      loads.push({ module, exports: null, condition: null });
    }
    for (const spec of startup.loads) {
      const module = builder.resolveModule(spec.module, source);
      const exports = spec.exports === undefined ? null : resolveExportReads(context, spec.exports, source);
      if (spec.when !== undefined) builder.problems.add(source, `${spec.module}: a start-up load has no condition`);
      if (module === null || (spec.exports !== undefined && exports === null)) continue;
      modules.add(module);
      loads.push({ module, exports, condition: null });
    }
    const resolveOnce = (reference: FunctionRef): ModelFunction | null => {
      const resolved = builder.resolveFunction(reference, source);
      if (resolved !== null && (functionsCalledWithLoads.has(resolved) || moduleLoaderFunctions.has(resolved))) {
        builder.problems.add(source, `${reference.file}: ${reference.name} is listed as a start-up function twice`);
      }
      return resolved;
    };
    for (const spec of startup.functionsCalledWithLoads.map(calledFunctionOf)) {
      const resolved = resolveOnce(spec.function);
      const uses = spec.uses === undefined ? null : resolveHostUses(context, spec.uses, source);
      if (spec.when !== undefined)
        builder.problems.add(source, `${spec.function.name}: a start-up function has no condition`);
      if (resolved === null || (spec.uses !== undefined && uses === null)) continue;
      functionsCalledWithLoads.set(resolved, { function: resolved, condition: null, uses });
    }
    for (const reference of startup.moduleLoaderFunctions) {
      const resolved = resolveOnce(reference);
      if (resolved !== null) moduleLoaderFunctions.add(resolved);
    }
  }
  for (const { module } of nativeLoads) modules.add(module);
  return {
    modules: [...modules].sort(compareIds),
    loads: mergeModuleLoads(loads),
    functionsCalledWithLoads: [...functionsCalledWithLoads.values()].sort((left, right) =>
      compareIds(left.function, right.function),
    ),
    namesOfMethodsCallingLoads: [...namesOfMethodsCallingLoads].sort(compareNames),
    moduleLoaderFunctions: [...moduleLoaderFunctions].sort(compareIds),
  };
}

function buildHostObjects(context: AttachmentContext): ModelHostObject[] {
  const { builder } = context;
  const objects: ModelHostObject[] = [];
  for (const { value: declared, source } of declarationsOf(builder, "HostObject")) {
    const internalFields = declared.internalFields.map(({ index, uses }) => ({
      index,
      uses: resolveHostUses(context, uses, source),
    }));
    const described = declared.function === null ? null : builder.resolve(declared.function, source);
    const prototype = declared.prototype === null ? null : resolveObject(builder, declared.prototype, source);
    if ((declared.function !== null && described === null) || (declared.prototype !== null && prototype === null))
      continue;
    objects.push({
      cell: builder.internName(declared.cell, "Text"),
      function: described,
      prototype,
      fields: declared.fields.flatMap(({ name, values }) =>
        values.map(value => ({
          name: name === null ? null : builder.internComponent(name),
          value: resolveHostValue(context, value, source),
        })),
      ),
      internalFields: internalFields.flatMap(({ index, uses }) => (uses === null ? [] : [{ index, uses }])),
      keepsStringsOfStoredValues: declared.keepsStringsOfStoredValues,
      source,
    });
  }
  return objects.sort((left, right) => compareNames(left.cell, right.cell));
}

function buildNamedMemberCalls(context: AttachmentContext): ModelNamedMemberCall[] {
  const { builder } = context;
  return declarationsOf(builder, "NamedMemberCall")
    .map(({ value: declared, source }) => ({
      name: builder.internComponent(declared.name),
      arguments: declared.arguments.map(value => resolveHostValue(context, value, source)),
      source,
    }))
    .sort((left, right) => compareNames(left.name, right.name));
}

function buildHostMethodCalls(context: AttachmentContext): ModelHostMethodCall[] {
  const { builder } = context;
  return declarationsOf(builder, "HostMethodCall")
    .flatMap(({ value: declared, source }) => {
      const call = resolveHostCall(context, declared.call, source);
      if (call === null) return [];
      return [
        { name: builder.internComponent(declared.name), cell: builder.internName(declared.cell, "Text"), call, source },
      ];
    })
    .sort((left, right) => compareNames(left.name, right.name) || compareNames(left.cell, right.cell));
}

export function buildAttachments(builder: ModelBuilder, features: readonly TableFeature[], types: TypeInterner): void {
  const context: AttachmentContext = {
    builder,
    types,
    featureNames: new Set(features.map(feature => feature.name)),
    nativeLoads: collectNativeLoads(builder),
    nativeCalls: collectNativeCalls(builder),
    textForms: new Map(),
  };
  for (const builtin of builder.builtins) {
    if (builtin.sameObjectAs === null) builtin.attachments = buildEntryAttachments(context, builtin);
    else checkAliasColumns(builder, builtin, builtin.sameObjectAs);
  }
  inheritFeatureUses(context);
  finishTextForms(context);
  finishLiteralPartsForms(context);
  builder.features = [...context.featureNames];
  builder.boxedStubs = collectBoxedStubs(builder);
  builder.hostReads = buildHostReads(builder);
  builder.hostObjects = buildHostObjects(context);
  builder.namedMemberCalls = buildNamedMemberCalls(context);
  builder.hostMethodCalls = buildHostMethodCalls(context);
  builder.startup = buildStartup(context);
  classifyUnseenCode(builder);
}

function collectSeenCode(builder: ModelBuilder): SeenCode {
  const holders = new Set<ModelBuiltin>();
  const nativeFiles = new Set<string>();
  for (const { value: seen, source } of declarationsOf(builder, "SeenCodeOnly")) {
    for (const path of seen.holders) {
      const holder = resolveObject(builder, path, source);
      if (holder !== null) holders.add(holder);
    }
    for (const file of seen.nativeFiles) nativeFiles.add(file);
  }
  const bindingFiles = new Map<ModelBuiltin, string>();
  for (const { value: binding } of declarationsOf(builder, "NativeBinding")) {
    const builtin = builder.find(pathOfNativeBinding(binding.kind, binding.file, binding.symbol));
    if (builtin !== undefined) bindingFiles.set(builtin, binding.file);
  }
  for (const [made, binding] of builder.bindingsOfFunctions) {
    const file = bindingFiles.get(binding);
    if (file !== undefined) bindingFiles.set(made, file);
  }
  return { holders, nativeFiles, bindingFiles };
}

function runsNativeCode(builtin: ModelBuiltin): boolean {
  switch (builtin.kind) {
    case "Namespace":
    case "Prototype":
    case "Constant":
      return false;
    case "DataProperty":
      return builtin.flags.includes("IsLazilyCreated");
    case "Constructor":
    case "Function":
    case "Method":
    case "Accessor":
    case "NativeBinding":
      return true;
  }
}

function runsOnlySeenCode(builder: ModelBuilder, seen: SeenCode, builtin: ModelBuiltin): boolean {
  if (!runsNativeCode(builtin)) return true;
  const isWritten = builder.signaturesOf(builtin).length > 0;
  if (isWritten && builtin.overloads.every(overload => !overload.flags.includes("IsUndeclared"))) return true;
  if (builtin.origin === "Engine") return true;
  for (let owner: ModelBuiltin | null = builtin; owner !== null; owner = owner.holder) {
    if (seen.holders.has(owner)) return true;
  }
  const bindingFile = seen.bindingFiles.get(builtin);
  if (bindingFile !== undefined) return seen.nativeFiles.has(bindingFile);
  return writtenColumn(builder, builtin, "nativeSymbols").some(({ source }) => seen.nativeFiles.has(source.file));
}

function markUnseenCode(builtin: MutableBuiltin, condition: ModelCondition | null): void {
  if (condition === null || condition.hasProperty === null) addFlag(builtin, "RunsUnseenCode");
  builtin.attachments = { ...builtin.attachments, unseenCodeCondition: condition };
}

function applyUnseenCodeColumn(
  builder: ModelBuilder,
  builtin: MutableBuiltin,
  { value, source }: Written<boolean | ConditionSpec>,
): void {
  if (value === false) return;
  const condition = value === true ? null : resolveCondition(builder, builtin, value, source);
  if (value === true || condition !== null) markUnseenCode(builtin, condition);
}

function classifyTextForms(builder: ModelBuilder): void {
  for (const builtin of builder.builtins) {
    const form = builtin.attachments.jsonTextForm;
    if (form === null || !builtin.flags.includes("RunsUnseenCode")) continue;
    const created = builder.find(textFormPathOf(builtin));
    if (created !== undefined && created === form.builtin) markUnseenCode(created, null);
  }
}

export function classifyUnseenCode(builder: ModelBuilder): void {
  const seen = collectSeenCode(builder);
  const textFormHolder = builder.find(textFormRoot);
  for (const builtin of builder.builtins) {
    const isTextForm = textFormHolder !== undefined && builtin.holder === textFormHolder;
    if (builtin.sameObjectAs !== null || isTextForm) continue;
    const [written] = writtenColumn(builder, builtin, "runsUnseenCode");
    if (written !== undefined) {
      applyUnseenCodeColumn(builder, builtin, written);
    } else if (!runsOnlySeenCode(builder, seen, builtin)) {
      builder.problems.add(
        builder.sourceOf(builtin),
        `${builtin.text} runs native code nobody has classified: declare it, or list its holder or file in host/unseen-code.builtins.ts`,
      );
    }
  }
  classifyTextForms(builder);
}
