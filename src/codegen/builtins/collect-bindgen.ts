import { AssertionError } from "node:assert";
import { relative, sep } from "node:path";
import {
  checkedWordsOf,
  cppConstructorSymbol,
  cppExtern,
  cppFunctionSymbol,
  cppNamespaceSymbol,
  externType,
  getterHostFunctionName,
  getterSymbolName,
  methodHostFunctionName,
  methodSymbolName,
  pathOfBoundNamespace,
  setterSymbolName,
  thunkSymbol,
  type SchemaFile,
} from "../bindgen-emit.ts";
import {
  AnyType,
  ArrayType,
  ClassType,
  Constant,
  DictionaryType,
  FunctionDefinition,
  Getter,
  InternalFieldAccessor,
  Method,
  RefType,
  RestType,
  Signature,
  Type,
  memberIdentifier,
  symbolDescription,
  type Builtin,
  type ClassMember,
  type NamespaceDefinition,
  type OverloadDispatch,
  type ValueKind,
} from "../bindgen-lib-internal.ts";
import { loadSchemaFile } from "../bindgen-load.ts";
import { nativeCallList } from "../generate-js2native.ts";
import {
  GeneratorError,
  type Declaration,
  type DispatchDeclaration,
  type MemberDeclaration,
  type Problems,
  type SourcedDeclaration,
} from "./declarations.ts";
import * as b from "./lib.ts";
import { compareBytes, joinPath, parsePath, pathOfClassMember, pathOfNativeBinding } from "./paths.ts";
import {
  conversionProtocols,
  maximumDirectParameterCount,
  realmParameter,
  type BuiltinPath,
  type Capability,
  type DirectEntrySpec,
  type DirectForm,
  type DirectParameterSpec,
  type EntryColumns,
  type FeatureUseSpec,
  type Heap,
  type KeyedProtocol,
  type ParameterType,
  type Primitive,
  type ProtocolSpec,
  type TypeSpec,
  type UseSpec,
} from "./vocabulary.ts";

type Kind = ValueKind | "other";

interface DeclaredField extends b.SignatureOptions, EntryColumns {
  args: Readonly<Record<string, b.TableType>>;
  returns: b.TableType;
}

interface Receiver {
  type: ParameterType;
  uses: readonly UseSpec[];
}

interface Joins {
  placements: ReadonlyMap<string, BuiltinPath>;
  /** What the files of the table declare themselves. */
  writtenMembers: ReadonlySet<BuiltinPath>;
  /** The features that the files of the table give an entry. The functions of a namespace leave with the `$bindgen` that hands them out. */
  writtenFeatureUses: ReadonlyMap<BuiltinPath, readonly FeatureUseSpec[]>;
  nativeBindings: ReadonlySet<BuiltinPath>;
}

const externalStateHeap: Heap = "ExternalState";
const externalState: readonly Heap[] = [externalStateHeap];

const heldValuesAnswered = b.reachableValuesStoredIn(b.result);

const usesWithoutJavaScript: readonly UseSpec[] = [
  b.retained,
  b.returned,
  b.readsContents(),
  b.writesContents(),
  b.reachableValuesStoredIn(b.nativeMemory),
  heldValuesAnswered,
];

// A getter that is not passed its wrapper can neither keep it nor answer it. It may answer a value that the object holds.
const usesOfGetterWithoutWrapper: readonly UseSpec[] = [b.readsContents(), b.writesContents(), heldValuesAnswered];

const usesThatReachResult: readonly UseSpec[] = [b.returned, heldValuesAnswered];

/** The thunk of a member takes the cell of its receiver behind the realm. */
const receiverParameter: DirectParameterSpec = { value: "Receiver", cppType: "JSC::JSCell*" };

function createSourcedDeclarations(file: string, declarations: readonly Declaration[]): SourcedDeclaration[] {
  return declarations.map((declaration): SourcedDeclaration => ({
    declaration,
    source: {
      file,
      line: null,
      origin: "Host",
      proof: declaration.declares === "Member" && declaration.signatures.length > 0 ? "ByConstruction" : "Structure",
    },
  }));
}

function setMemberParts(
  declarations: readonly Declaration[],
  parts: Partial<Pick<MemberDeclaration, "length" | "dispatches">>,
): Declaration[] {
  return declarations.map(declaration =>
    declaration.declares === "Member" ? { ...declaration, ...parts } : declaration,
  );
}

const immediatePrimitives: Readonly<Record<Primitive, boolean>> = {
  Undefined: true,
  Null: true,
  Boolean: true,
  Number: true,
  String: false,
  Symbol: false,
  BigInt: false,
  NotPassed: true,
};

const createStrictType = (spec: TypeSpec): b.TableType =>
  new b.TableType({ ...b.never.parameter, accepted: spec, converted: spec });

export function cppSymbolOf(fn: FunctionDefinition): string {
  return cppFunctionSymbol(fn);
}

function getKindType(kind: Kind): b.TableType {
  if (kind instanceof Type) return createStrictType(kind.parameterType.accepted);
  if (typeof kind === "object" && kind.cpp === "JSC::DateInstance") return b.instance("Date");
  if (typeof kind === "object") throw new GeneratorError(`the class of ${kind.cpp} is unknown: the kind is not a type`);
  switch (kind) {
    case "undefined":
      return b.union(b.undefined, b.notPassed);
    case "null":
      return b.strictNull;
    case "boolean":
      return b.bool;
    case "number":
      return b.f64;
    case "bigint":
      return b.bigint;
    case "string":
      return b.string;
    case "stringObject":
      return b.instance("String");
    case "array":
      return b.instance("Array");
    case "arrayBuffer":
      return b.union(b.instance("ArrayBuffer"), b.instance("SharedArrayBuffer"));
    case "arrayBufferView":
      return b.union(b.instance("TypedArray"), b.instance("DataView"));
    case "callable":
      return createStrictType({ type: "Function" });
    case "other":
      return b.any;
  }
}

export function typeOfKind(kind: ValueKind | "other"): TypeSpec {
  return getKindType(kind).spec;
}

export function dispatchOfBindgen(
  fn: FunctionDefinition,
  dispatchWithin = (signature: Signature): DispatchDeclaration => ({ signature: fn.signatures.indexOf(signature) }),
): DispatchDeclaration {
  const converted = new Map<OverloadDispatch, DispatchDeclaration>();
  const convertNode = ({ argument, byKind }: Exclude<OverloadDispatch, Signature>): DispatchDeclaration => {
    const groups = Array.from(
      Map.groupBy(byKind, ([, target]) => target),
      ([target, entries]) => ({ target, kinds: entries.map(([kind]) => kind) }),
    );
    const isFallback = ({ kinds }: { kinds: readonly Kind[] }) => kinds.includes("other");
    return {
      argument,
      branches: [
        ...groups
          .filter(group => !isFallback(group))
          .map(({ target, kinds: [first, ...others] }) => ({
            tested: b.union(getKindType(first), ...others.map(getKindType)).spec,
            then: convert(target),
          })),
        ...groups.filter(isFallback).map(({ target }) => ({ tested: typeOfKind("other"), then: convert(target) })),
      ],
    };
  };
  const convert = (dispatch: OverloadDispatch): DispatchDeclaration => {
    const existing = converted.get(dispatch);
    if (existing !== undefined) return existing;
    const declaration = dispatch instanceof Signature ? dispatchWithin(dispatch) : convertNode(dispatch);
    converted.set(dispatch, declaration);
    return declaration;
  };
  return convert(fn.dispatch);
}

const isContainer = (type: Type): boolean => type instanceof ArrayType || type instanceof DictionaryType;

function collectParts(roots: readonly Type[]): Set<Type> {
  const parts = new Set<Type>();
  const visit = (type: Type): void => {
    if (parts.has(type)) return;
    parts.add(type);
    type.dependencies.forEach(visit);
  };
  roots.forEach(visit);
  return parts;
}

function findContainers(type: Type): Type[] {
  return isContainer(type) ? [type] : type.dependencies.flatMap(findContainers);
}

function acceptsStringObject(spec: TypeSpec): boolean {
  if (spec.type === "Union") return spec.members.some(acceptsStringObject);
  return spec.type === "Instance" && spec.class === "String";
}

function computeContentProtocols(containers: readonly Type[]): ProtocolSpec[] {
  const protocols = new Set<KeyedProtocol>();
  const names = new Set<string>();
  for (const part of collectParts(containers.flatMap(container => container.dependencies))) {
    if (part instanceof ArrayType) protocols.add("Iterate");
    const { accepted, conversion, members } = part.parameterType;
    if (acceptsStringObject(accepted)) protocols.add("ToPrimitive");
    for (const protocol of conversionProtocols[conversion]) {
      if (protocol === "Named") members.forEach(member => names.add(member));
      else if (protocol !== "CallsNamed") protocols.add(protocol);
    }
  }
  return [...protocols, ...(names.size > 0 ? [b.named(...names)] : [])];
}

/** The wrapper hands the argument to `stringOfStringObject`, which runs the `toString` of a `String` object, whatever else the type accepts. */
function convertsStringObject(type: Type): boolean {
  return (type instanceof RestType ? type.element : type).cppPrepare("") !== null;
}

function computeConversionUses(type: Type): UseSpec[] {
  const runsToString = acceptsStringObject(type.parameterType.accepted) || convertsStringObject(type);
  const ownConversion = runsToString ? [b.runs("ToPrimitive")] : [];
  const containers = findContainers(type);
  if (containers.length === 0) return ownConversion;
  const contentProtocols = computeContentProtocols(containers);
  return [
    ...ownConversion,
    b.readsContents(),
    ...(containers.some(container => container instanceof ArrayType) ? [b.runs("Iterate")] : []),
    ...(contentProtocols.length > 0 ? [b.runsTransitively(...contentProtocols)] : []),
  ];
}

// Whoever says what a member of a class answers has read it, its setter too, and writes `uses` for an operand that it changes.
const saysResult = (type: Type): boolean => !(type instanceof AnyType) || type.isDeclaredResult;

function computeBodyUses(type: Type, capability: Capability, isRead: boolean): readonly UseSpec[] {
  const sharesNativeObject = () => [...collectParts([type])].some(part => part instanceof RefType);
  if (type.holdsJSValue || type.passesValue || sharesNativeObject()) {
    if (isRead) return b.handedOver;
    return capability === "js" ? [b.everything] : usesWithoutJavaScript;
  }
  return type.borrowsHeap ? [b.readsContents()] : [];
}

function mayHoldInstanceOf(spec: TypeSpec, className: string): boolean {
  switch (spec.type) {
    case "Never":
    case "Primitive":
    case "Integers":
    case "StringLiterals":
      return false;
    case "Union":
      return spec.members.some(member => mayHoldInstanceOf(member, className));
    case "Instance":
      return spec.class === className;
    default:
      return true;
  }
}

// A member that is passed its wrapper may answer it: `returns: b.self` is any object of the class, the receiver too.
function computeReceiverUses(signature: Signature, className: string | null): readonly UseSpec[] {
  const changesReceiver = signature instanceof Method && signature.receiver === "mut";
  if (signature instanceof Method && saysResult(signature.returns) && !changesReceiver) {
    const mayAnswerReceiver =
      signature.passThis && className !== null && mayHoldInstanceOf(signature.returns.resultType, className);
    return mayAnswerReceiver ? [...b.handedOver, b.returned] : b.handedOver;
  }
  if (signature.capability === "js") return [b.everything];
  // A function that is no member of a class has a receiver only if its body is handed `this`.
  if (!(signature instanceof Method) || signature.passThis) return usesWithoutJavaScript;
  return [b.readsContents(), b.writesContents()];
}

function createReceiver(signature: Signature, type: ParameterType | null, className: string | null): Receiver | null {
  return type === null ? null : { type, uses: computeReceiverUses(signature, className) };
}

function isImmediate(spec: TypeSpec): boolean {
  switch (spec.type) {
    case "Anything":
    case "Never":
    case "Integers":
      return true;
    case "Primitive":
      return immediatePrimitives[spec.primitive];
    case "Union":
      return spec.members.every(isImmediate);
    case "StringLiterals":
    case "Object":
    case "Function":
    case "PlainData":
    case "Instance":
    case "InstanceOfReceiverClass":
    case "TypedArrayOfReceiverElementType":
    case "Layout":
    case "Builtin":
    case "Operand":
    case "Slot":
    case "IteratedValues":
    case "CallbackResult":
    case "Prototype":
      return false;
  }
}

// What the call gets for the argument is no cell, or a cell that is left as it is.
function leavesCellsAlone(type: Type, converted: TypeSpec): boolean {
  return isImmediate(converted) || (type.isReadInPlace && Bun.deepEquals(converted, type.directForm?.type));
}

// The wrapper goes over a list by the @@iterator that the operand has.
const iteratesOperand = ({ args }: Signature): boolean =>
  args.some(({ type }) => findContainers(type).some(container => container instanceof ArrayType));

function capabilityOf(signature: Signature, result: TypeSpec, converted: readonly TypeSpec[]): Capability {
  const { args, capability } = signature;
  if (iteratesOperand(signature)) return "js";
  const touchesNoCell =
    isImmediate(result) && args.every(({ type }, index) => leavesCellsAlone(type, converted[index]));
  return capability === "none" && !touchesNoCell ? "heap" : capability;
}

// A member of a class that runs JavaScript reads and writes whatever that does, and nothing is said of it beside that.
function createField(
  signature: Signature,
  receiver: Receiver | null,
  result: TypeSpec,
  isOfClass = signature instanceof Method,
): DeclaredField {
  const { args, capability, columns } = signature;
  const isRead = signature instanceof Method && saysResult(signature.returns);
  const uses = { ...columns.uses } as Record<string, readonly UseSpec[]>;
  for (const { name, type } of args) {
    uses[name] = [
      ...(columns.uses?.[name] ?? computeBodyUses(type, capability, isRead)),
      ...computeConversionUses(type),
    ];
  }
  if (receiver !== null) uses.this ??= receiver.uses;
  else if (isRead && signature.receiver !== "static") uses.this ??= b.handedOver;
  return {
    ...columns,
    this: receiver === null ? undefined : new b.TableType(receiver.type),
    args: Object.fromEntries(
      args.map(({ name, type }, index): [string, b.TableType] => {
        const isFollowedByRequired = index < signature.requiredCount;
        const parameter = type.parameterType;
        return [name, new b.TableType(isFollowedByRequired ? { ...parameter, mode: "Required" } : parameter)];
      }),
    ),
    returns: createStrictType(result),
    resultIsDeclaredOnly: checkedWordsOf(signature.returns) !== null || undefined,
    capability: capabilityOf(
      signature,
      result,
      args.map(({ type }) => type.parameterType.converted),
    ),
    runsOnlyOperandCode:
      columns.runsOnlyOperandCode ?? ((capability !== "js" && iteratesOperand(signature)) || undefined),
    throws: signature.throws || signature.requiredArguments > 0 || args.some(({ type }) => type.canRefuse),
    uses,
    reads: columns.reads ?? (isOfClass && capability === "js" ? undefined : externalState),
    writes: columns.writes ?? (isOfClass && capability === "js" ? undefined : externalState),
    implementation: columns.implementation ?? b.hostCall,
  };
}

// The object that is made of a dictionary has a property for each member that is there, in their order, and the file that declares the dictionary declares the layout.
function findLayoutOfResult({ returns }: Signature, fn: FunctionDefinition): DictionaryType | null {
  if (!(returns instanceof DictionaryType) || returns.origin?.stem !== fn.origin?.stem) return null;
  // An object of a layout inherits from Object.prototype.
  if (returns.nullPrototype) return null;
  return returns.members.every(({ type }) => !type.takesUndefined) ? returns : null;
}

function resultTypeOf(signature: Signature, fn: FunctionDefinition): TypeSpec {
  const layout = findLayoutOfResult(signature, fn);
  return layout === null ? signature.returns.resultType : b.ordinaryObjectOf(layout.name).fresh.spec;
}

function declareLayoutsOfResults(functions: readonly FunctionDefinition[]): Declaration[] {
  const layouts = new Set(
    functions.flatMap(fn => fn.signatures.flatMap(signature => findLayoutOfResult(signature, fn) ?? [])),
  );
  return Array.from(layouts, ({ name, members }) =>
    b.layout(name, Object.fromEntries(members.map(member => [member.name, createStrictType(member.type.resultType)]))),
  ).flat();
}

function findDirectForms({ args }: Signature, leadingCount: number): DirectForm[] | null {
  if (leadingCount + args.length > maximumDirectParameterCount) return null;
  const forms = args.flatMap(({ type }) => type.directForm ?? []);
  const registerCount = forms.reduce(
    (count, { value }) => count + (value === "RestOfValues" ? 2 : value === "Double" ? 0 : 1),
    leadingCount,
  );
  return forms.length === args.length && registerCount <= maximumDirectParameterCount ? forms : null;
}

// An argument that others follow is always there.
function adaptForm(form: DirectForm, { mode }: ParameterType): DirectForm {
  return form.value === "ValueOrEmpty" && mode !== "Optional" ? { ...form, value: "Value" } : form;
}

const modesOfDirectValues: Partial<Record<DirectForm["value"], ParameterType["mode"]>> = {
  RestOfValues: "Rest",
  ValueOrEmpty: "Optional",
};

// An argument that is left out is not one that is `undefined`, which the host function takes for absent.
const exactSpecOf = ({ value, type }: DirectForm): TypeSpec =>
  value === "ValueOrEmpty" && type.type !== "Anything" ? b.union(createStrictType(type), b.notPassed).spec : type;

function createExactType(form: DirectForm): b.TableType {
  return new b.TableType({
    ...createStrictType(exactSpecOf(form)).parameter,
    mode: modesOfDirectValues[form.value] ?? "Required",
  });
}

// The overloads of one signature, and the arguments whose types tell the first from the second where there are two.
interface SignatureFields {
  fields: readonly DeclaredField[];
  narrowed: readonly { argument: number; tested: TypeSpec }[];
}

// The host function converts the arguments and calls the thunk. Compiled code calls the thunk with arguments that converting would leave as they are.
function createFields(general: DeclaredField, signature: Signature, thunk: string | null): SignatureFields {
  const takesReceiver = signature instanceof Method && signature.receiver !== "static";
  const leading = takesReceiver ? [realmParameter, receiverParameter] : [realmParameter];
  const found = thunk === null ? null : findDirectForms(signature, leading.length);
  if (thunk === null || found === null) return { fields: [general], narrowed: [] };
  const forms = found.map((form, index) => adaptForm(form, general.args[signature.args[index].name].parameter));
  const headers = new Set<string>();
  for (const { type } of signature.args) type.getHeaders(headers);
  const directEntry = {
    symbol: thunk,
    declaration: cppExtern(thunk, signature, takesReceiver ? [receiverParameter.cppType] : []),
    headers: [...headers],
    parameters: [...leading, ...forms.map(({ value, cppType }) => ({ value, cppType }))],
  };
  const exact = forms.map(createExactType);
  const narrowed = signature.args.flatMap(({ name }, argument) =>
    Bun.deepEquals(exact[argument].parameter, general.args[name].parameter)
      ? []
      : [{ argument, tested: exactSpecOf(forms[argument]) }],
  );
  if (narrowed.length === 0) return { fields: [{ ...general, directEntry }], narrowed };
  const isNarrowed = (name: string) => narrowed.some(({ argument }) => signature.args[argument].name === name);
  const usesOfOthers = Object.entries(general.uses ?? {}).filter(([name]) => !isNarrowed(name));
  const specialCase: DeclaredField = {
    ...b.withoutEntryColumns(general),
    args: Object.fromEntries(signature.args.map(({ name }, index) => [name, exact[index]])),
    uses: Object.fromEntries(usesOfOthers) as DeclaredField["uses"],
    capability: capabilityOf(
      signature,
      general.returns.spec,
      forms.map(({ type }) => type),
    ),
    throws: signature.throws,
    isSpecialCase: true,
    directEntry,
  };
  return { fields: [specialCase, general], narrowed };
}

function collectFunction(
  fn: FunctionDefinition,
  path: BuiltinPath,
  receiver: ParameterType | null,
  thunkOf: (signature: Signature) => string | null,
  className: string | null = null,
): Declaration[] {
  const resultOf = (signature: Signature): TypeSpec => {
    const result = resultTypeOf(signature, fn);
    const ignoresOtherReceivers =
      signature instanceof Method && signature.receiver !== "static" && signature.invalidThis === "undefined";
    return ignoresOtherReceivers ? b.union(createStrictType(result), b.undefined).spec : result;
  };
  const overloads = fn.signatures.map(signature =>
    createFields(
      createField(signature, createReceiver(signature, receiver, className), resultOf(signature)),
      signature,
      // The host function counts the arguments and turns what is thrown into a rejected promise. The thunk does neither.
      signature.requiredArguments > 0 || signature.rejects ? null : thunkOf(signature),
    ),
  );
  const fields = overloads.flatMap(overload => overload.fields);
  // Nobody has read a member of a class of which the schema says nothing but that it is there.
  const isUnread = fn.signatures.every(
    signature =>
      signature instanceof Method && !saysResult(signature.returns) && Object.keys(signature.columns).length === 0,
  );
  const dispatchWithin = (signature: Signature): DispatchDeclaration => {
    const { fields: own, narrowed } = overloads[fn.signatures.indexOf(signature)];
    const general: DispatchDeclaration = { signature: fields.indexOf(own.at(-1)!) };
    return narrowed.reduceRight<DispatchDeclaration>(
      (then, { argument, tested }) => ({
        argument,
        branches: [
          { tested, then },
          { tested: typeOfKind("other"), then: general },
        ],
      }),
      { signature: fields.indexOf(own[0]) },
    );
  };
  const isUnderPrototype = parsePath(path).at(-2) === "prototype";
  const written = isUnread ? [...fields, b.otherwiseBy(b.hostCall)] : fields;
  return setMemberParts(isUnderPrototype ? b.method(path, written) : b.fn(path, written), {
    length: fn.length,
    // The last overload of a member that nobody has read is for the receivers that are no instances, which no argument tells.
    dispatches: isUnread ? [] : [{ mode: "Call", root: dispatchOfBindgen(fn, dispatchWithin) }],
  });
}

export function declareFunction(fn: FunctionDefinition, path: BuiltinPath): Declaration[] {
  // The thunk of a function that is handed `this` or itself takes those in front of the arguments, so nothing but the host function enters it.
  const takesArgumentsAlone = !fn.passThis && !fn.passCallee;
  return collectFunction(fn, path, fn.passThis ? b.any.parameter : null, signature =>
    takesArgumentsAlone ? thunkSymbol(fn, signature) : null,
  );
}

function computeCachedResult(spec: TypeSpec): TypeSpec {
  switch (spec.type) {
    case "PlainData":
      return b.object.spec;
    case "Instance":
      return b.instance(spec.class).spec;
    case "Union":
      return { type: "Union", members: spec.members.map(computeCachedResult) };
    case "Anything":
    case "Object":
    case "InstanceOfReceiverClass":
    case "TypedArrayOfReceiverElementType":
    case "Layout":
      return { ...spec, freshness: "No" };
    case "Never":
    case "Primitive":
    case "Integers":
    case "StringLiterals":
    case "Function":
    case "Builtin":
    case "Operand":
    case "Slot":
    case "IteratedValues":
    case "CallbackResult":
    case "Prototype":
      return spec;
  }
}

function mayHoldObject(spec: TypeSpec): boolean {
  switch (spec.type) {
    case "Never":
    case "Primitive":
    case "Integers":
    case "StringLiterals":
      return false;
    case "Union":
      return spec.members.some(mayHoldObject);
    default:
      return true;
  }
}

// A getter that runs no JavaScript. One whose type holds no object answers nothing that it found in its receiver.
function usesOfGetterReceiver(passesWrapper: boolean, result: TypeSpec): readonly UseSpec[] {
  const uses = passesWrapper ? usesWithoutJavaScript : usesOfGetterWithoutWrapper;
  return mayHoldObject(result) ? uses : uses.filter(use => !usesThatReachResult.includes(use));
}

const isLocked = (type: ClassType): boolean => type.columns.lockedObjects?.includes("prototype") ?? false;
/** JavaScript holds an instance itself, and no function that is bound to one. */
const hasInstanceReceiver = (type: ClassType): boolean => !type.forBind;
const headerOf = (type: ClassType): string => `Generated${type.origin!.namespace}.h`;

// The getter of the table casts its receiver and calls this thunk. What it holds the answer to in a build with assertions, compiled code tests itself.
function directEntryOfGetter(type: ClassType, getter: Getter): DirectEntrySpec | undefined {
  if (getter.internalField !== undefined) return undefined;
  const symbol = getterSymbolName(type, getter);
  return {
    symbol,
    declaration: `extern "C" SYSV_ABI JSC::EncodedJSValue ${symbol}(JSC::JSGlobalObject*, JSC::JSCell*);`,
    headers: [headerOf(type)],
    parameters: [realmParameter, receiverParameter],
  };
}

// The setter of the table does the same for a store.
function directEntryOfSetter(type: ClassType, getter: Getter): DirectEntrySpec | undefined {
  const form = getter.type.directForm;
  if (form?.value !== "Value") return undefined;
  const native = setterSymbolName(type, getter);
  const symbol = `AOT__${native}`;
  return {
    symbol,
    declaration: [
      `extern "C" SYSV_ABI bool ${native}(JSC::JSGlobalObject*, JSC::JSCell*, ${externType(getter.type)});`,
      `static SYSV_ABI JSC::EncodedJSValue ${symbol}(JSC::JSGlobalObject* globalObject, JSC::JSCell* thisObject, ${form.cppType} value)`,
      `{`,
      `    return ${native}(globalObject, thisObject, value) ? JSC::JSValue::encode(JSC::jsUndefined()) : JSC::encodedJSValue();`,
      `}`,
    ].join("\n"),
    headers: [headerOf(type)],
    parameters: [realmParameter, receiverParameter, { value: form.value, cppType: form.cppType }],
  };
}

type SymbolColumns = Pick<
  EntryColumns,
  "nativeSymbols" | "customGetter" | "directEntryOfGetter" | "directEntryOfSetter"
>;

// The function takes its receiver for an instance without a test: the engine tests that before it enters a getter of the table.
function symbolColumnsOfAccessor(type: ClassType, accessor: Getter | InternalFieldAccessor): SymbolColumns {
  const getter = accessor instanceof Getter ? accessor : null;
  if (getter?.isStatic || !hasInstanceReceiver(type)) return {};
  const symbol = getterHostFunctionName(type, accessor);
  return {
    nativeSymbols: [...(getter?.columns.nativeSymbols ?? []), symbol],
    customGetter: symbol,
    directEntryOfGetter: getter === null ? undefined : directEntryOfGetter(type, getter),
    // A store is resolved only where the accessor cannot be replaced.
    directEntryOfSetter: getter?.hasSetter && isLocked(type) ? directEntryOfSetter(type, getter) : undefined,
  };
}

function createStructureMember(
  path: BuiltinPath,
  kind: MemberDeclaration["kind"],
  length: number | null,
  columns: EntryColumns = {},
): MemberDeclaration {
  return {
    declares: "Member",
    path,
    kind,
    isOwnPropertyOfInstances: false,
    isLazilyCreated: false,
    signatures: [],
    dispatches: [],
    constant: null,
    length,
    columns,
  };
}

const declareMember = (path: BuiltinPath, isStatic: boolean, field: b.Field): Declaration[] =>
  isStatic ? b.static(path, field) : b.method(path, field);

/** Any value that is assigned is kept, or handed to a setter that somebody has read if the getter says what it answers. */
const setterTakingAnything = (isRead: boolean, isStatic: boolean): b.SetterOptions => ({
  value: b.any,
  capability: "js",
  throws: true,
  uses: isRead ? { ...(isStatic ? {} : { this: b.handedOver }), value: b.handedOver } : undefined,
});

// The field that a read of the property finds the answer in, once it is there. A property that can be redefined may be something else.
function cachedFieldOf(type: ClassType, accessor: Getter | InternalFieldAccessor): string | null {
  if (accessor.internalField === undefined || !hasInstanceReceiver(type)) return null;
  const isConfigurable = (accessor instanceof Getter ? accessor.configurable : undefined) ?? type.configurable;
  return isConfigurable ? null : accessor.internalField;
}

function collectAccessor(type: ClassType, accessor: Getter | InternalFieldAccessor, path: BuiltinPath): Declaration[] {
  const getter = accessor instanceof Getter ? accessor : null;
  const isStatic = getter?.isStatic ?? false;
  const columns = getter?.columns ?? {};
  const cachedField = cachedFieldOf(type, accessor);
  const isRead = getter !== null && saysResult(getter.type);
  const runsNoJavaScript = isRead || cachedField !== null || (getter !== null && getter.capability !== "js");
  const symbolColumns = symbolColumnsOfAccessor(type, accessor);
  if (!runsNoJavaScript && Object.keys(columns).length === 0) {
    return [createStructureMember(path, "Accessor", null, symbolColumns)];
  }
  const written = getter === null ? b.any.spec : getter.type.resultType;
  const result = accessor.internalField === undefined ? written : computeCachedResult(written);
  const isPure = getter?.isPure ?? false;
  const touchesNoCell = getter !== null && getter.capability === "none" && !getter.passThis && isImmediate(result);
  const isAssignable = accessor.hasSetter || (getter?.writable ?? false);
  const usesOfReceiver = isPure ? [b.readsContents()] : usesOfGetterReceiver(getter?.passThis ?? false, result);
  return declareMember(path, isStatic, {
    ...columns,
    ...symbolColumns,
    this: isStatic ? b.any : undefined,
    getter: createStrictType(result),
    resultIsDeclaredOnly: (getter !== null && checkedWordsOf(getter.type) !== null) || undefined,
    setter: isAssignable ? setterTakingAnything(isRead, isStatic) : undefined,
    capability: touchesNoCell ? "none" : runsNoJavaScript ? "heap" : "js",
    throws: getter === null || getter.capability === "js" || getter.throws,
    uses: isStatic
      ? { this: b.inspected, ...columns.uses }
      : runsNoJavaScript
        ? { this: usesOfReceiver, ...columns.uses }
        : columns.uses,
    reads: columns.reads ?? externalState,
    writes: columns.writes ?? (isPure ? [] : externalState),
    implementation:
      cachedField === null
        ? columns.implementation
        : { how: "CachedGetter", cppClass: type.cpp, member: `m_${cachedField}` },
  });
}

/** A property that can be redefined may hold something else. */
function collectConstant(type: ClassType, constant: Constant, path: BuiltinPath): Declaration[] {
  const isConfigurable = constant.configurable ?? type.configurable;
  return b.method(path, isConfigurable ? b.property(b.any) : b.constant(constant.value));
}

function collectBuiltin(type: ClassType, builtin: Builtin, path: BuiltinPath): Declaration[] {
  const implementation = b.compiled(`builtins/${type.name}`, memberIdentifier(builtin.name));
  return setMemberParts(b.method(path, b.otherwiseBy(implementation)), { length: builtin.length });
}

// The host function takes the receiver and the arguments out of the frame and converts them itself.
function directEntryOfMethod(type: ClassType, fn: FunctionDefinition): DirectEntrySpec {
  const symbol = methodHostFunctionName(type, fn);
  return {
    symbol,
    declaration: `JSC_DECLARE_HOST_FUNCTION(${symbol});`,
    headers: [],
    parameters: [realmParameter, { value: "FrameOfValues", cppType: "JSC::CallFrame*" }],
  };
}

function collectClassMember(type: ClassType, member: ClassMember, path: BuiltinPath, isStatic: boolean): Declaration[] {
  if (member instanceof Getter || member instanceof InternalFieldAccessor) return collectAccessor(type, member, path);
  if (member instanceof Constant) return collectConstant(type, member, path);
  if (!(member instanceof FunctionDefinition)) return collectBuiltin(type, member, path);
  const methods = member.signatures as readonly Method[];
  if (methods.some(method => method.privateSymbol !== undefined)) return [];
  if (isStatic) return collectFunction(member, path, null, signature => methodSymbolName(type, signature as Method));
  if (!hasInstanceReceiver(type)) return collectFunction(member, path, null, () => null);
  // The host function answers undefined for a receiver that is no instance, and the thunk takes an instance.
  if (methods[0].invalidThis === "undefined")
    return collectFunction(member, path, b.any.parameter, () => null, type.name);
  const thunkOf = (signature: Signature) => methodSymbolName(type, signature as Method);
  return collectFunction(member, path, type.parameterType, thunkOf, type.name).map(declaration =>
    declaration.declares === "Member"
      ? { ...declaration, columns: { ...declaration.columns, directEntryOfMethod: directEntryOfMethod(type, member) } }
      : declaration,
  );
}

const pathOfMember = (classPath: BuiltinPath, side: "static" | "proto", name: string): BuiltinPath =>
  pathOfClassMember(classPath, side, name === "@@inspectCustom" ? `@@@${symbolDescription(name)}` : name);

function prototypeBaseOf(type: ClassType): BuiltinPath | null {
  if (type.forBind) return "Function.prototype";
  return type.prototypeBase === "Error" ? "Error.prototype" : null;
}

// A class is written `%Name%`, whether or not something holds its constructor: declareRoots() in build-entries.ts finds the global or the member of a native module that has its name.
function pathOfClass(
  type: ClassType,
  { placements }: Joins,
): { path: BuiltinPath; constructorPath: BuiltinPath | undefined } {
  const placed = placements.get(cppConstructorSymbol(type));
  const components = placed === undefined ? [] : parsePath(placed);
  const isFoundByName = components.length <= 1 || components.at(-1) === type.name;
  return {
    path: isFoundByName ? `%${type.name}%` : placed!,
    constructorPath: components.length > 1 ? placed : undefined,
  };
}

const pathOfConstructorBinding = (type: ClassType): BuiltinPath =>
  pathOfNativeBinding("Bindgen", `${type.origin!.stem}.bind.ts`, type.name);

function collectConstruction(type: ClassType): DeclaredField | undefined {
  const { construct, name } = type;
  if (construct === null) return undefined;
  if (type.illegalConstructor)
    return { ...createField(construct, null, b.never.spec, true), capability: "heap", throws: true };
  const instance = b.instance(name);
  // A constructor that makes the object itself can keep it.
  return createField(construct, null, (type.passStructure ? instance : instance.fresh).spec, true);
}

function collectClass(type: ClassType, joins: Joins): Declaration[] {
  const { construct, name, cpp } = type;
  const { path, constructorPath } = pathOfClass(type, joins);
  const prototypeBase = prototypeBaseOf(type);
  const ofInstances = hasInstanceReceiver(type);
  const declared = b.class(path, {
    types: [...(constructorPath === undefined ? [] : [b.exactType(constructorPath)]), b.exactType(`$Bindgen.${name}`)],
    stateHeap: externalStateHeap,
    ...type.columns,
    extends: type.base?.name,
    instanceCppClass: ofInstances ? b.cppClass(cpp, headerOf(type)) : undefined,
    prototypeCppExpression: ofInstances ? `Bun::Bindgen::prototypeForClass<${cpp}>(globalObject)` : undefined,
    instanceStructureCppExpression: ofInstances
      ? `globalObject->m_bindgenAdditions.m_classes[${cpp}::classIndex].getConcurrently()`
      : undefined,
    hasConstructor: construct !== null,
    construct: collectConstruction(type),
  });
  const byName = (left: ClassMember, right: ClassMember) => compareBytes(left.name, right.name);
  const binding = pathOfConstructorBinding(type);
  return [
    // `$bindgen` of the class is its constructor, which the realm makes at the first request.
    ...(joins.nativeBindings.has(binding)
      ? b.static(binding, {
          getter: b.builtin(path),
          capability: "heap",
          implementation: b.generic,
          runsUnseenCode: false,
        })
      : []),
    ...setMemberParts(
      declared.map(declaration => (declaration.declares === "Class" ? { ...declaration, name } : declaration)),
      { length: construct === null ? null : (construct.length ?? construct.requiredCount) },
    ),
    ...(prototypeBase === null ? [] : b.inherits(joinPath([path, "prototype"]), prototypeBase)),
    ...type.protoMembers
      .toSorted(byName)
      .flatMap(member => collectClassMember(type, member, pathOfMember(path, "proto", member.name), false)),
    ...type.staticMembers
      .toSorted(byName)
      .flatMap(member => collectClassMember(type, member, pathOfMember(path, "static", member.name), true)),
  ];
}

function collectNamespace(namespace: NamespaceDefinition, path: BuiltinPath): Declaration[] {
  return [
    ...b.namespace(path, {}, namespace.columns),
    ...(namespace.call === undefined ? [] : declareFunction(namespace.call, path)),
    ...namespace.functions.flatMap(fn => declareFunction(fn, joinPath([path, fn.name]))),
  ];
}

function collectBoundNamespace(
  namespace: NamespaceDefinition,
  path: BuiltinPath,
  binding: BuiltinPath,
  header: string,
  usesFeature: readonly FeatureUseSpec[],
): Declaration[] {
  return [
    ...b.namespace(path, {}, { scope: "Module", listsAllMembers: true, ...namespace.columns }),
    ...(usesFeature.length > 0 ? b.extend(path, { usesFeature }) : []),
    ...(namespace.call === undefined ? b.inherits(path, "Object.prototype") : declareFunction(namespace.call, path)),
    ...namespace.functions.flatMap(fn => [
      ...declareFunction(fn, joinPath([path, fn.name])),
      ...b.extend(joinPath([path, fn.name]), {
        functionObjectCode: { symbol: cppSymbolOf(fn), header, name: fn.name },
      }),
    ]),
    ...b.static(binding, {
      getter: b.builtin(path),
      capability: "heap",
      implementation: b.generic,
      runsUnseenCode: false,
    }),
  ];
}

/** `$bindgen` of a `b.value` is what the Rust function returns. */
function collectValue(fn: FunctionDefinition, binding: BuiltinPath): Declaration[] {
  const [signature] = fn.signatures;
  return b.static(binding, {
    runsUnseenCode: false,
    ...signature.columns,
    getter: createStrictType(resultTypeOf(signature, fn)),
    capability: signature.capability === "none" ? "heap" : signature.capability,
    throws: signature.throws,
    implementation: b.generic,
  });
}

function findFunctionPath(fn: FunctionDefinition, schemaFileName: string, joins: Joins): BuiltinPath | null {
  const placedPath = joins.placements.get(cppSymbolOf(fn));
  if (placedPath !== undefined) return placedPath;
  const bindingPath = pathOfNativeBinding("Bindgen", schemaFileName, fn.name);
  return joins.nativeBindings.has(bindingPath) ? bindingPath : null;
}

function collectSchema(schema: SchemaFile, joins: Joins, report: (message: string) => void): Declaration[] {
  const { stem, namespace: cppNamespace } = schema.origin;
  const tryCollect = (collect: () => Declaration[]): Declaration[] => {
    try {
      return collect();
    } catch (error) {
      if (!(error instanceof AssertionError || error instanceof GeneratorError)) throw error;
      report(error.message);
      return [];
    }
  };
  const placedFunctions = new Set<FunctionDefinition>();
  const declaredFunctions: FunctionDefinition[] = [];
  const declarations: Declaration[] = [];
  for (const namespace of schema.namespaces) {
    const path = joins.placements.get(cppNamespaceSymbol(namespace));
    const binding = pathOfNativeBinding("Bindgen", `${stem}.bind.ts`, namespace.name);
    const isBound = joins.nativeBindings.has(binding);
    for (const fn of namespace.functions) placedFunctions.add(fn);
    if (path === undefined && !isBound) continue;
    declaredFunctions.push(...namespace.functions);
    if (path !== undefined) declarations.push(...tryCollect(() => collectNamespace(namespace, path)));
    if (!isBound) continue;
    const boundPath = pathOfBoundNamespace(namespace);
    const header = `Generated${cppNamespace}.h`;
    const usesFeature = joins.writtenFeatureUses.get(binding) ?? [];
    declarations.push(...tryCollect(() => collectBoundNamespace(namespace, boundPath, binding, header, usesFeature)));
  }
  for (const fn of schema.functions) {
    if (placedFunctions.has(fn)) continue;
    const path = findFunctionPath(fn, `${stem}.bind.ts`, joins);
    if (path === null) continue;
    if (fn.isValue) {
      // A file of the table that says what the value is says more than its type does.
      if (!joins.writtenMembers.has(path)) declarations.push(...tryCollect(() => collectValue(fn, path)));
      continue;
    }
    declaredFunctions.push(fn);
    declarations.push(...tryCollect(() => declareFunction(fn, path)));
    if (!joins.nativeBindings.has(path)) continue;
    declarations.push(
      ...b.extend(path, {
        functionObjectCode: { symbol: cppSymbolOf(fn), header: `Generated${cppNamespace}.h`, name: fn.name },
      }),
    );
  }
  for (const type of schema.types) {
    if (!(type instanceof ClassType)) continue;
    declarations.push(...tryCollect(() => collectClass(type, joins)));
  }
  declarations.push(...declareLayoutsOfResults(declaredFunctions));
  return declarations;
}

function findNativeBindings(): Set<BuiltinPath> {
  return new Set(
    nativeCallList()
      .filter(call => call.type === "bind")
      .map(call => pathOfNativeBinding("Bindgen", call.file, call.symbol)),
  );
}

export interface CollectedSchemas {
  declarations: SourcedDeclaration[];
  /** What `$bindgen` answers a constructor, a namespace or a value for, and no function of its own. */
  bindingsOfOtherValues: ReadonlySet<BuiltinPath>;
}

export async function collectBindgen(
  bunRoot: string,
  sources: readonly string[],
  placements: ReadonlyMap<string, BuiltinPath>,
  writtenMembers: ReadonlySet<BuiltinPath>,
  writtenFeatureUses: ReadonlyMap<BuiltinPath, readonly FeatureUseSpec[]>,
  problems: Problems,
): Promise<CollectedSchemas> {
  const joins: Joins = { placements, writtenMembers, writtenFeatureUses, nativeBindings: findNativeBindings() };
  // A type is named by the file that exports it, and another file may use it.
  const loaded: { file: string; schema: SchemaFile }[] = [];
  for (const source of [...sources].sort(compareBytes)) {
    const file = relative(bunRoot, source.slice(source.indexOf("=") + 1))
      .split(sep)
      .join("/");
    const schema = await loadSchemaFile(source).catch((error: Error) => {
      problems.add(null, error.message);
      return null;
    });
    if (schema !== null) loaded.push({ file, schema });
  }
  const declarations = loaded.flatMap(({ file, schema }) => {
    const report = (message: string) =>
      problems.add({ file, line: null, origin: "Host", proof: "ByConstruction" }, message);
    return createSourcedDeclarations(file, collectSchema(schema, joins, report));
  });
  const classes = loaded.flatMap(({ schema }) => schema.types.filter(type => type instanceof ClassType));
  const bindingsOfFile = ({ origin, namespaces, functions }: SchemaFile) =>
    [...namespaces, ...functions.filter(fn => fn.isValue)].map(({ name }) =>
      pathOfNativeBinding("Bindgen", `${origin.stem}.bind.ts`, name),
    );
  return {
    declarations,
    bindingsOfOtherValues: new Set([
      ...classes.map(pathOfConstructorBinding),
      ...loaded.flatMap(({ schema }) => bindingsOfFile(schema)),
    ]),
  };
}
