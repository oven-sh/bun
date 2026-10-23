import { resolveOwnSlot, type ModelBuilder, type MutableBuiltin, type WrittenSignature } from "./build-entries.ts";
import type { TypeInterner } from "./build-types.ts";
import { applyWrittenUses, deriveHeaps, deriveUsesOfResult, OverloadContext, type EntryContext } from "./build-uses.ts";
import type { SignatureDeclaration, Source } from "./declarations.ts";
import * as b from "./lib.ts";
import { addFlag } from "./model-builder.ts";
import {
  overloadFlags,
  type BuiltinFlag,
  type ModelBuiltin,
  type ModelClass,
  type ModelConstant,
  type ModelFunction,
  type ModelImplementation,
  type ModelOperand,
  type ModelOverload,
  type ModelParameter,
  type ModelResult,
  type ModelResultLayout,
  type OverloadFlag,
} from "./model.ts";
import { joinPath } from "./paths.ts";
import {
  conversionProtocols,
  conversionsFailingByValue,
  iterationKinds,
  typedArrayTypes,
  type BuiltinKind,
  type CalleeKind,
  type CallMode,
  type ClassName,
  type EntryColumns,
  type ImplementationSpec,
  type OperandName,
  type OperandRole,
  type ParameterMode,
  type ParameterType,
  type Primitive,
  type TypeSpec,
} from "./vocabulary.ts";

export { applyUses, deriveHeaps, deriveUsesOfResult, OverloadContext } from "./build-uses.ts";

type CompiledSpec = Extract<ImplementationSpec, { how: "Compiled" }>;
type HostCallSpec = Extract<ImplementationSpec, { how: "HostCall" }>;
type InlineSpec = Extract<ImplementationSpec, { how: "Inline" }>;
type CalledImplementation = Extract<ModelImplementation, { how: "Generic" | "HostCall" | "Compiled" }>;

const receiverName: OperandName = "this";
const maximumParameterCount = 255;
const maximumByte = 0xff;
const byteKind = "UInt8";
const genericImplementation: CalledImplementation = { how: "Generic" };

const entryFlagsByRole: Readonly<Record<OperandRole, BuiltinFlag | null>> = {
  EvaluatedAsText: "EvaluatesText",
  ModuleSpecifier: "LoadsModuleByName",
  ReadAsCharacters: null,
  Locale: null,
  ContentKey: null,
  ReplacesContents: null,
  MembersAreOnlyInspected: null,
  KeysAreNotListed: null,
  MembersAreOfObjectsOnly: null,
  FunctionsAreConvertedUnderNamesOnly: null,
  BecomesLengthOfReceiver: null,
  CopiesHolesToResult: null,
};

const engineEnumerators: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ["IterationKind", iterationKinds],
  ["TypedArrayType", typedArrayTypes],
]);

function listsPrimitive(spec: TypeSpec, primitive: Primitive): boolean {
  if (spec.type === "Union") return spec.members.some(member => listsPrimitive(member, primitive));
  return spec.type === "Primitive" && spec.primitive === primitive;
}

function withNotPassed(spec: TypeSpec): TypeSpec {
  return listsPrimitive(spec, "Undefined") ? { type: "Union", members: [spec, b.notPassed.spec] } : spec;
}

function modeOf({ mode, accepted }: ParameterType): ParameterMode {
  const takesOmissionButNotUndefined = listsPrimitive(accepted, "NotPassed") && !listsPrimitive(accepted, "Undefined");
  return mode === "Required" && takesOmissionButNotUndefined ? "Optional" : mode;
}

export function buildParameter(
  context: OverloadContext,
  name: string,
  operand: ModelOperand,
  type: ParameterType,
): ModelParameter {
  const { builder, types, source } = context;
  const isArgument = operand.operand !== "Receiver";
  const intern = (spec: TypeSpec) => types.intern(isArgument ? withNotPassed(spec) : spec, null, source);
  return {
    name,
    operand,
    mode: modeOf(type),
    accepted: intern(type.accepted),
    conversion: type.conversion,
    converted: intern(type.converted),
    refused: intern(type.refused),
    admitted: type.admitted === undefined ? null : intern(type.admitted),
    uses: ["Inspects"],
    roles: [],
    protocols: conversionProtocols[type.conversion],
    namedMembers: type.members.map(member => builder.internComponent(member)),
    calledMembers: [],
    convertedMembers: [],
  };
}

function receiverClassOf({ kind, flags, holder }: ModelBuiltin): ModelClass | null {
  if (holder === null || holder.kind !== "Prototype") return null;
  switch (kind) {
    case "Method":
    case "Accessor":
      return holder.instanceClass;
    case "DataProperty":
      return flags.includes("IsOwnPropertyOfInstances") ? holder.instanceClass : null;
    case "Namespace":
    case "Constructor":
    case "Function":
    case "Prototype":
    case "Constant":
    case "NativeBinding":
      return null;
  }
}

function instanceReceiverOf(context: OverloadContext, receiverClass: ModelClass): ParameterType {
  if (receiverClass.isPrimitiveWrapper) {
    context.report(`${receiverClass.token} wraps a primitive, so each signature of its members writes its receiver`);
    return b.any.parameter;
  }
  if (receiverClass.instanceTest === "None" && receiverClass.slots.length === 0) return b.any.parameter;
  return b.instance(context.builder.writtenClassOf(receiverClass).declaration.name).parameter;
}

function defaultReceiverOf(context: OverloadContext): ParameterType | null {
  const { builtin, signature } = context;
  const receiverClass = receiverClassOf(builtin);
  if (receiverClass !== null) return instanceReceiverOf(context, receiverClass);
  if (builtin.holder !== null && builtin.flags.includes("RequiresHolderAsThis")) {
    return b.builtin(joinPath(builtin.holder.path)).parameter;
  }
  return Object.hasOwn(signature.uses ?? {}, receiverName) ? b.any.parameter : null;
}

function receiverTypeOf(context: OverloadContext): ParameterType | null {
  const { mode, receiver, isUndeclared } = context.signature;
  if (mode === "Construct") {
    if (receiver !== null) context.report("a Construct signature has no receiver");
    return null;
  }
  if (receiver !== null) return receiver;
  return isUndeclared ? null : defaultReceiverOf(context);
}

function declareOperands(context: OverloadContext): void {
  const { parameters } = context.signature;
  const receiver = receiverTypeOf(context);
  if (receiver !== null) context.declare(buildParameter(context, receiverName, { operand: "Receiver" }, receiver));
  if (parameters.length > maximumParameterCount) {
    context.report(`${parameters.length} parameters are more than the ${maximumParameterCount} an operand can number`);
  }
  for (const [index, { name, type }] of parameters.entries()) {
    const isRest = type.mode === "Rest";
    if (isRest && index !== parameters.length - 1) context.report(`the rest parameter ${name} is not the last one`);
    context.declare(buildParameter(context, name, { operand: isRest ? "ArgumentsFrom" : "Argument", index }, type));
  }
}

function withConstructedClass(spec: TypeSpec, constructed: ClassName): TypeSpec {
  if (spec.type === "Union") {
    return { type: "Union", members: spec.members.map(member => withConstructedClass(member, constructed)) };
  }
  if (spec.type !== "InstanceOfReceiverClass") return spec;
  return { type: "Instance", class: constructed, freshness: spec.freshness };
}

function resultSpecOf(context: OverloadContext): TypeSpec {
  const { kind, instanceClass } = context.builtin;
  const { result } = context.signature;
  if (kind !== "Constructor" || instanceClass === null || context.hasReceiver) return result;
  return withConstructedClass(result, context.builder.writtenClassOf(instanceClass).declaration.name);
}

function findPosition(words: readonly string[] | undefined, word: string): number | null {
  const position = words === undefined ? -1 : words.indexOf(word);
  return position < 0 ? null : position;
}

function numberOfInlineParameter(context: OverloadContext, kind: string, written: string | number): number | null {
  const { schema, checkedNumbers } = context.builder;
  if (typeof written === "number") return kind === byteKind ? written : null;
  const enumerator = findPosition(schema.enums.get(kind), written);
  if (enumerator !== null) return enumerator;
  const flag = findPosition(schema.flags.get(kind), written);
  if (flag !== null) return 2 ** flag;
  if (!schema.externals.has(kind)) return null;
  const engineEnumerator = findPosition(engineEnumerators.get(kind), written);
  if (engineEnumerator !== null) checkedNumbers.push({ value: engineEnumerator, cppExpression: `${kind}::${written}` });
  return engineEnumerator;
}

function resolveInlineParameter(context: OverloadContext, kind: string, written: string | number): string | null {
  const number = numberOfInlineParameter(context, kind, written);
  if (number !== null && Number.isInteger(number) && number >= 0 && number <= maximumByte) return String(number);
  context.report(`${written} is not a ${kind} that fits in a byte`);
  return null;
}

function linkCompiledFunction(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  spec: CompiledSpec,
  source: Source,
): ModelFunction | null {
  const compiled = builder.resolveFunction(spec.function, source);
  if (compiled === null) return null;
  if (!compiled.implements.includes(builtin)) compiled.implements.push(builtin);
  if (spec.usesStubConvention) compiled.usesStubConvention = true;
  return compiled;
}

function resolveCompiled(context: OverloadContext, spec: CompiledSpec): CalledImplementation {
  const compiled = linkCompiledFunction(context.builder, context.builtin, spec, context.source);
  if (compiled === null) return genericImplementation;
  return { how: "Compiled", callee: context.hostCallee, function: compiled };
}

function resolveHostCall(context: OverloadContext, spec: HostCallSpec): CalledImplementation {
  const customGetter = spec.customGetter ?? null;
  const callee = customGetter === null ? context.hostCallee : "CustomGetter";
  return { how: "HostCall", callee, function: context.libraryFunction, customGetter };
}

function resolveOtherwise(context: OverloadContext, spec: InlineSpec["otherwise"]): CalledImplementation | null {
  switch (spec.how) {
    case "HostCall":
      return resolveHostCall(context, spec);
    case "Compiled":
      return resolveCompiled(context, spec);
    case "Nothing":
      return null;
  }
}

function resolveInline(context: OverloadContext, spec: InlineSpec): ModelImplementation {
  const otherwise = resolveOtherwise(context, spec.otherwise);
  const declared = context.builder.schema.inlineBuiltins.get(spec.builtin);
  if (declared === undefined) {
    context.report(`the schema declares no inline built-in ${spec.builtin}`);
    return otherwise ?? genericImplementation;
  }
  if (declared.parameters.length !== spec.parameters.length) {
    context.report(`${spec.builtin} takes ${declared.parameters.length} parameters, not ${spec.parameters.length}`);
    return otherwise ?? genericImplementation;
  }
  return {
    how: "Inline",
    builtin: spec.builtin,
    parameters: spec.parameters.flatMap(
      (written, index) => resolveInlineParameter(context, declared.parameters[index], written) ?? [],
    ),
    maximumArgumentCount: spec.maximumArgumentCount ?? null,
    otherwise,
  };
}

function defaultImplementationOf(context: OverloadContext): ImplementationSpec {
  switch (context.signature.mode) {
    case "Call":
    case "Construct":
      return b.hostCall;
    case "Get":
    case "Set":
      return context.builtin.kind === "Accessor" ? b.hostCall : b.generic;
  }
}

export function resolveImplementation(
  context: OverloadContext,
  spec: ImplementationSpec | undefined,
): ModelImplementation {
  const written = spec ?? defaultImplementationOf(context);
  switch (written.how) {
    case "Generic":
      return genericImplementation;
    case "HostCall":
      return resolveHostCall(context, written);
    case "Compiled":
      return resolveCompiled(context, written);
    case "Inline":
      return resolveInline(context, written);
    case "CachedGetter":
      return { how: "CachedGetter", cppClass: written.cppClass, member: written.member };
    case "OwnSlot":
      return resolveOwnSlot(context.builder, context.builtin, written);
  }
}

function resolveModel(context: OverloadContext): ModelFunction | null {
  const { model } = context.signature;
  if (model === undefined) return null;
  const resolved = context.builder.resolveFunction(model, context.source);
  if (resolved === null) return null;
  switch (resolved.role) {
    case "CompilerFunction":
    case "Model":
      resolved.role = "Model";
      return resolved;
    case "EngineBuiltin":
    case "HostBuiltin":
      context.report(
        `${model.file}: ${model.name} has the role ${resolved.role}, so it is emitted, and a model never is`,
      );
      return null;
  }
}

function resolveRangeOperand(context: OverloadContext): ModelOperand | null {
  const { range } = context.signature;
  if (range === undefined) return null;
  const written = range.operand === undefined ? null : context.operandOf(range.operand, context.source);
  switch (range.rule) {
    case "None":
      return null;
    case "MinimumOfArguments":
    case "MaximumOfArguments":
      return range.operand === undefined ? { operand: "ArgumentsFrom", index: 0 } : written;
    case "AbsoluteValue":
    case "IntegerPart":
    case "Sign":
      if (range.operand === undefined) context.report(`the range rule ${range.rule} needs the operand it applies to`);
      return written;
  }
}

function layoutsNamedIn(builder: ModelBuilder, spec: TypeSpec): ModelResultLayout[] {
  switch (spec.type) {
    case "Layout": {
      const layout = builder.findLayout(spec.layout);
      return layout === undefined ? [] : [{ layout, isOrdinaryObject: spec.isOrdinaryObject ?? false }];
    }
    case "Union":
      return spec.members.flatMap(member => layoutsNamedIn(builder, member));
    case "Instance":
      return Object.values(spec.contents ?? {}).flatMap(held => layoutsNamedIn(builder, held));
    case "Anything":
    case "Never":
    case "Primitive":
    case "Integers":
    case "StringLiterals":
    case "Object":
    case "Function":
    case "PlainData":
    case "InstanceOfReceiverClass":
    case "TypedArrayOfReceiverElementType":
    case "Builtin":
    case "Operand":
    case "Slot":
    case "IteratedValues":
    case "Prototype":
    case "CallbackResult":
      return [];
  }
}

function buildResult(context: OverloadContext): ModelResult {
  const { range, substringOf, typedResultForm, iterates, prototypeSource, resultsByPlatform = [] } = context.signature;
  const operandOf = (name: OperandName | undefined) =>
    name === undefined ? null : context.operandOf(name, context.source);
  return {
    type: context.resultType,
    typesByPlatform: resultsByPlatform.map(({ platform, result }) => ({
      platform,
      type: context.types.intern(result, context, context.source),
    })),
    layouts: layoutsNamedIn(context.builder, resultSpecOf(context)),
    rangeRule: range?.rule ?? "None",
    rangeOperand: resolveRangeOperand(context),
    substringOf: operandOf(substringOf),
    typedResultForm: typedResultForm?.form ?? "None",
    typedResultSource: operandOf(typedResultForm?.source),
    iteratedOperand: operandOf(iterates?.operand),
    iterationKind: iterates?.kind ?? null,
    prototypeSource: operandOf(prototypeSource),
    properties: (context.signature.resultProperties ?? []).map(({ name, type }) => ({
      name: context.builder.internComponent(name),
      type: context.types.intern(type, context, context.source),
    })),
  };
}

// The built-in throws for a negative index before it converts the operands behind the index. A conversion of one of them that ran
// before the call would run code that the call never runs.
export function mayRefuseValueBeforeConversion(
  operands: readonly Pick<ModelParameter, "conversion" | "admitted">[],
): boolean {
  const first = operands.findIndex(
    ({ conversion, admitted }) => conversionsFailingByValue.includes(conversion) || admitted !== null,
  );
  if (first === -1) return false;
  return operands.slice(first + 1).some(({ conversion }) => conversionProtocols[conversion].includes("ToPrimitive"));
}

function flagsOf(context: OverloadContext): OverloadFlag[] {
  const { signature, source } = context;
  const isSet: Readonly<Record<OverloadFlag, boolean>> = {
    IsUndeclared: signature.isUndeclared,
    IsProvenByConstruction: source.proof === "ByConstruction",
    Throws: signature.throws,
    RunsOnlyOperandCode: signature.runsOnlyOperandCode ?? false,
    ReadsStateBeforeConversions:
      (signature.readsStateBeforeConversions ?? false) ||
      mayRefuseValueBeforeConversion(context.states.map(state => state.parameter)),
    IsSpecialCase: signature.isSpecialCase ?? false,
    OnlyPropagatesErrors: signature.onlyPropagatesErrors ?? false,
    ResultIsDeclaredOnly: signature.resultIsDeclaredOnly ?? false,
  };
  return overloadFlags.filter(flag => isSet[flag]);
}

function buildOverload(context: OverloadContext, constantImplementation: ModelImplementation | null): ModelOverload {
  const { builtin, signature, source } = context;
  declareOperands(context);
  context.resultType = context.types.intern(resultSpecOf(context), context, source);
  applyWrittenUses(context);
  deriveUsesOfResult(context);
  return {
    id: -1,
    indexInBuiltin: -1,
    builtin,
    mode: signature.mode,
    source,
    proof: source.proof,
    flags: flagsOf(context),
    receiver: context.finishReceiver(),
    parameters: context.finishParameters(),
    result: buildResult(context),
    effects: deriveHeaps(context),
    flow: {
      transfers: context.transfers,
      callbacks: context.callbacks,
      propertyActions: context.propertyActions,
      handlerCalls: context.handlerCalls,
    },
    code: {
      implementation: constantImplementation ?? resolveImplementation(context, signature.implementation),
      directEntry: signature.directEntry ?? null,
      model: resolveModel(context),
      fieldsForm: signature.fieldsForm ?? null,
      prefixForm: signature.prefixForm ?? null,
      prefixProperties: (signature.prefixProperties ?? []).map(({ name, type }) => ({
        name: context.builder.internComponent(name),
        type: context.types.intern(type, context, source),
      })),
      listForm: signature.listForm ?? null,
    },
    textHash: "",
  };
}

function typeOfConstant(constant: ModelConstant): TypeSpec {
  switch (constant.constant) {
    case "Number": {
      const { value } = constant;
      return Number.isSafeInteger(value) && !Object.is(value, -0) ? b.int(value, value).spec : b.f64.spec;
    }
    case "String":
      return b.enumeration(constant.texts.map(({ text }) => text.text)).spec;
    case "Symbol":
      return b.symbol.spec;
    case "Undefined":
      return b.undefined.spec;
  }
}

function implementationOfConstant(constant: ModelConstant): ModelImplementation {
  switch (constant.constant) {
    case "Number":
      return { how: "Number" };
    case "Symbol":
      return { how: "Cell" };
    case "String":
    case "Undefined":
      return genericImplementation;
  }
}

function buildConstantOverload(entry: EntryContext, constant: ModelConstant): ModelOverload {
  const signature: SignatureDeclaration = {
    mode: "Get",
    receiver: null,
    parameters: [],
    result: typeOfConstant(constant),
    capability: "none",
    throws: false,
    isUndeclared: false,
  };
  const source = entry.builder.sourceOf(entry.builtin);
  return buildOverload(new OverloadContext(entry, { signature, source }), implementationOfConstant(constant));
}

function createUndeclaredSignature(mode: CallMode, implementation?: ImplementationSpec): SignatureDeclaration {
  return {
    mode,
    receiver: null,
    parameters: [{ name: "operands", type: b.any.rest.parameter }],
    result: b.any.spec,
    capability: "js",
    throws: true,
    isUndeclared: true,
    implementation,
  };
}

function modesOf(
  kind: BuiltinKind,
  declared: ReadonlySet<CallMode>,
  { constructable = false, hasSetter = !declared.has("Get") && !declared.has("Set") }: EntryColumns,
): readonly CallMode[] {
  switch (kind) {
    case "Function":
    case "Method":
    case "NativeBinding":
      return constructable ? ["Call", "Construct"] : ["Call"];
    case "Constructor":
      return ["Call", "Construct"];
    case "Accessor":
      return hasSetter ? ["Get", "Set"] : ["Get"];
    case "Namespace":
    case "Prototype":
    case "DataProperty":
    case "Constant":
      return [];
  }
}

const kindsOfFunctions: readonly BuiltinKind[] = ["Constructor", "Function", "Method"];
const lengthOfFunction = b.int(0, 2 ** 31 - 1);

// ECMAScript and WebIDL create every built-in function with a `length` that is a whole number and a `name` that is a string, and every @@toStringTag that they create as a data property holds a string.
export function typeOfPropertyWithoutWrittenType({ name, holder }: Pick<ModelBuiltin, "name" | "holder">): TypeSpec {
  if (name.kind === "WellKnownSymbol") return name.text === "toStringTag" ? b.string.spec : b.any.spec;
  if (name.kind !== "Text" || holder === null || !kindsOfFunctions.includes(holder.kind)) return b.any.spec;
  if (name.text === "length") return lengthOfFunction.spec;
  return name.text === "name" ? b.string.spec : b.any.spec;
}

function createPropertyReadSignature(builtin: ModelBuiltin): SignatureDeclaration {
  const isLazilyCreated = builtin.flags.includes("IsLazilyCreated");
  return {
    mode: "Get",
    receiver: null,
    parameters: [],
    result: typeOfPropertyWithoutWrittenType(builtin),
    capability: isLazilyCreated ? "js" : "none",
    throws: isLazilyCreated,
    isUndeclared: false,
    implementation: b.generic,
  };
}

function collectSignatures(builder: ModelBuilder, builtin: ModelBuiltin): readonly WrittenSignature[] {
  const written = builder.signaturesOf(builtin);
  const declared = new Set(written.map(({ signature }) => signature.mode));
  const source = builder.sourceOf(builtin);
  const columns: EntryColumns = Object.assign({}, ...builder.columnsOf(builtin).map(entry => entry.columns));
  const implementation = builder.functionsOfUnknownClass.has(builtin) ? b.generic : undefined;
  const undeclared = modesOf(builtin.kind, declared, columns)
    .filter(mode => !declared.has(mode))
    .map(mode => ({ signature: createUndeclaredSignature(mode, implementation), source }));
  if (builtin.kind !== "DataProperty" || declared.has("Get")) return [...written, ...undeclared];
  const read = createPropertyReadSignature(builtin);
  return [...written, ...undeclared, { signature: read, source }];
}

function compiledSpecsOf(spec: ImplementationSpec | undefined): CompiledSpec[] {
  if (spec === undefined) return [];
  switch (spec.how) {
    case "Compiled":
      return [spec];
    case "Inline":
      return spec.otherwise.how === "Compiled" ? [spec.otherwise] : [];
    case "Generic":
    case "HostCall":
    case "CachedGetter":
    case "OwnSlot":
      return [];
  }
}

function namesHostCall(spec: ImplementationSpec | undefined): boolean {
  if (spec === undefined) return false;
  switch (spec.how) {
    case "HostCall":
      return true;
    case "Inline":
      return spec.otherwise.how === "HostCall";
    case "Generic":
    case "Compiled":
    case "CachedGetter":
    case "OwnSlot":
      return false;
  }
}

function hasNativeFunction(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  signatures: readonly WrittenSignature[],
): boolean {
  const hasNativeSymbol = builder
    .columnsOf(builtin)
    .some(({ columns }) => (columns.nativeSymbols ?? []).length > 0 || columns.functionObjectCode !== undefined);
  return (
    hasNativeSymbol ||
    signatures.some(
      ({ signature, source }) => source.proof === "ByConstruction" || namesHostCall(signature.implementation),
    )
  );
}

function findLibraryFunction(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  signatures: readonly WrittenSignature[],
): ModelFunction | null {
  for (const { signature, source } of signatures) {
    for (const spec of compiledSpecsOf(signature.implementation)) {
      const compiled = linkCompiledFunction(builder, builtin, spec, source);
      if (compiled?.role === "EngineBuiltin" || compiled?.role === "HostBuiltin") return compiled;
    }
  }
  return null;
}

function hostCalleeOf(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  signatures: readonly WrittenSignature[],
  libraryFunction: ModelFunction | null,
): CalleeKind {
  if (builtin.kind === "Constructor") {
    const { instanceClass } = builtin;
    const columns = instanceClass === null ? null : builder.writtenClassOf(instanceClass).declaration.columns;
    return columns?.constructorCallee ?? "InternalFunction";
  }
  if (libraryFunction !== null) return "Function";
  return hasNativeFunction(builder, builtin, signatures) ? "HostFunction" : "Function";
}

function entryFlagsOf(overloads: readonly ModelOverload[]): Set<BuiltinFlag> {
  const flags = new Set<BuiltinFlag>();
  for (const { receiver, parameters } of overloads) {
    for (const operand of receiver === null ? parameters : [receiver, ...parameters]) {
      for (const role of operand.roles) {
        const flag = entryFlagsByRole[role];
        if (flag !== null) flags.add(flag);
      }
    }
  }
  return flags;
}

function buildOverloadsOf(builder: ModelBuilder, types: TypeInterner, builtin: MutableBuiltin): void {
  const signatures = collectSignatures(builder, builtin);
  const libraryFunction = findLibraryFunction(builder, builtin, signatures);
  const hostCallee = hostCalleeOf(builder, builtin, signatures, libraryFunction);
  const entry: EntryContext = { builder, types, builtin, hostCallee, libraryFunction };
  const overloads = signatures.map(written => {
    const overload = buildOverload(new OverloadContext(entry, written), null);
    builder.recordSignature(overload, written.signature);
    return overload;
  });
  if (builtin.constant !== null) overloads.push(buildConstantOverload(entry, builtin.constant));
  builtin.overloads = overloads;
  for (const flag of entryFlagsOf(overloads)) addFlag(builtin, flag);
}

export function buildOverloads(builder: ModelBuilder, types: TypeInterner): void {
  for (const builtin of builder.builtins) {
    if (builtin.sameObjectAs === null) buildOverloadsOf(builder, types, builtin);
  }
}
