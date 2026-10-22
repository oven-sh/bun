import { AssertionError } from "node:assert";
import { relative, sep } from "node:path";
import {
  cppConstructorSymbol,
  cppExtern,
  cppFunctionSymbol,
  cppNamespaceSymbol,
  methodSymbolName,
  thunkSymbol,
  type SchemaFile,
} from "../bindgen-emit.ts";
import {
  ArrayType,
  ClassType,
  DictionaryType,
  FunctionDefinition,
  Getter,
  Method,
  RefType,
  RestType,
  Signature,
  Type,
  type Builtin,
  type ClassMember,
  type NamespaceDefinition,
  type OverloadDispatch,
  type ValueKind,
} from "../bindgen-lib-internal.ts";
import { loadSchemaFile } from "../bindgen-load.ts";
import { nativeCallList } from "../generate-js2native.ts";
import {
  createSourcedDeclarations,
  externalState,
  externalStateHeap,
  setMemberParts,
  usesWithoutJavaScript,
} from "./collect-classes.ts";
import {
  GeneratorError,
  type Declaration,
  type DispatchDeclaration,
  type Problems,
  type SignatureDeclaration,
  type SourcedDeclaration,
} from "./declarations.ts";
import * as b from "./lib.ts";
import { compareBytes, joinPath, parsePath, pathOfClassMember, pathOfNativeBinding } from "./paths.ts";
import {
  conversionProtocols,
  maximumDirectParameterCount,
  realmParameter,
  type BuiltinPath,
  type CallMode,
  type Capability,
  type DirectForm,
  type EntryColumns,
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
  nativeBindings: ReadonlySet<BuiltinPath>;
}

const unplacedPath: BuiltinPath = "%Unplaced%";

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

function computeBodyUses(type: Type, capability: Capability): readonly UseSpec[] {
  const sharesNativeObject = () => [...collectParts([type])].some(part => part instanceof RefType);
  if (type.holdsJSValue || type.passesValue || sharesNativeObject()) {
    return capability === "js" ? [b.everything] : usesWithoutJavaScript;
  }
  return type.borrowsHeap ? [b.readsContents()] : [];
}

function computeReceiverUses(signature: Signature): readonly UseSpec[] {
  if (signature.capability === "js") return [b.everything];
  if (signature instanceof Method && signature.passThis) return usesWithoutJavaScript;
  return [b.readsContents(), b.writesContents()];
}

function createReceiver(signature: Signature, type: ParameterType | null): Receiver | null {
  return type === null ? null : { type, uses: computeReceiverUses(signature) };
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

function capabilityOf({ args, capability }: Signature, result: TypeSpec, converted: readonly TypeSpec[]): Capability {
  const touchesNoCell = isImmediate(result) && args.every(({ type }, index) => leavesCellsAlone(type, converted[index]));
  return capability === "none" && !touchesNoCell ? "heap" : capability;
}

function createField(signature: Signature, receiver: Receiver | null, result: TypeSpec): DeclaredField {
  const { args, capability, columns } = signature;
  const uses: Record<string, readonly UseSpec[]> = { ...columns.uses };
  for (const { name, type } of args) {
    uses[name] = [...(columns.uses?.[name] ?? computeBodyUses(type, capability)), ...computeConversionUses(type)];
  }
  if (receiver !== null) uses.this ??= receiver.uses;
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
    capability: capabilityOf(
      signature,
      result,
      args.map(({ type }) => type.parameterType.converted),
    ),
    throws: signature.throws || args.some(({ type }) => type.canRefuse),
    uses,
    reads: columns.reads ?? externalState,
    writes: columns.writes ?? externalState,
    implementation: columns.implementation ?? b.hostCall,
  };
}

export function signatureOfBindgen(
  signature: Signature,
  mode: CallMode,
  receiver: ParameterType | null,
): SignatureDeclaration {
  const field = createField(signature, createReceiver(signature, receiver), signature.returns.resultType);
  const [declared] = b
    .fn(unplacedPath, field)
    .flatMap(declaration => (declaration.declares === "Member" ? declaration.signatures : []));
  return { ...declared, mode };
}

// The thunk takes the realm in front of the arguments.
// The object that is made of a dictionary has a property for each member that is there, in their order. The file that declares
// the dictionary declares the layout.
function findLayoutOfResult({ returns }: Signature, fn: FunctionDefinition): DictionaryType | null {
  if (!(returns instanceof DictionaryType) || returns.origin?.stem !== fn.origin?.stem) return null;
  return returns.members.every(({ type }) => !type.takesUndefined) ? returns : null;
}

function resultTypeOf(signature: Signature, fn: FunctionDefinition): TypeSpec {
  const layout = findLayoutOfResult(signature, fn);
  return layout === null ? signature.returns.resultType : b.ordinaryObjectOf(layout.name).fresh.spec;
}

function declareLayoutsOfResults(functions: readonly FunctionDefinition[]): Declaration[] {
  const layouts = new Set(functions.flatMap(fn => fn.signatures.flatMap(signature => findLayoutOfResult(signature, fn) ?? [])));
  return Array.from(layouts, ({ name, members }) =>
    b.layout(name, Object.fromEntries(members.map(member => [member.name, createStrictType(member.type.resultType)]))),
  ).flat();
}

function findDirectForms({ args }: Signature): DirectForm[] | null {
  if (1 + args.length > maximumDirectParameterCount) return null;
  const forms = args.flatMap(({ type }) => type.directForm ?? []);
  return forms.length === args.length ? forms : null;
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
  return new b.TableType({ ...createStrictType(exactSpecOf(form)).parameter, mode: modesOfDirectValues[form.value] ?? "Required" });
}

// The overloads of one signature, and the arguments whose types tell the first from the second where there are two.
interface SignatureFields {
  fields: readonly DeclaredField[];
  narrowed: readonly { argument: number; tested: TypeSpec }[];
}

// The host function converts the arguments and calls the thunk. Compiled code calls the thunk with arguments that converting would leave as they are.
function createFields(general: DeclaredField, signature: Signature, thunk: string | null): SignatureFields {
  const found = thunk === null ? null : findDirectForms(signature);
  if (thunk === null || found === null) return { fields: [general], narrowed: [] };
  const forms = found.map((form, index) => adaptForm(form, general.args[signature.args[index].name].parameter));
  const headers = new Set<string>();
  for (const { type } of signature.args) type.getHeaders(headers);
  const directEntry = {
    symbol: thunk,
    declaration: cppExtern(thunk, signature),
    headers: [...headers],
    parameters: [realmParameter, ...forms.map(({ value, cppType }) => ({ value, cppType }))],
  };
  const exact = forms.map(createExactType);
  const narrowed = signature.args.flatMap(({ name }, argument) =>
    Bun.deepEquals(exact[argument].parameter, general.args[name].parameter) ? [] : [{ argument, tested: exactSpecOf(forms[argument]) }],
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
): Declaration[] {
  const overloads = fn.signatures.map(signature =>
    createFields(
      createField(signature, createReceiver(signature, receiver), resultTypeOf(signature, fn)),
      signature,
      thunkOf(signature),
    ),
  );
  const fields = overloads.flatMap(overload => overload.fields);
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
  return setMemberParts(isUnderPrototype ? b.method(path, fields) : b.fn(path, fields), {
    length: fn.length,
    dispatches: [{ mode: "Call", root: dispatchOfBindgen(fn, dispatchWithin) }],
  });
}

export function declareFunction(fn: FunctionDefinition, path: BuiltinPath): Declaration[] {
  return collectFunction(fn, path, null, signature => thunkSymbol(fn, signature));
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

function collectGetter(type: ClassType, getter: Getter, path: BuiltinPath): Declaration[] {
  const { capability, throws } = getter;
  const createAccessorField = (signature: Signature, result: TypeSpec): DeclaredField =>
    createField(
      signature,
      getter.isStatic ? { type: b.any.parameter, uses: b.inspected } : createReceiver(signature, type.parameterType),
      result,
    );
  const { args: noArguments, returns, ...read } = createAccessorField(
    new Signature({ ...getter.columns, returns: getter.type, capability, throws }),
    getter.cached ? computeCachedResult(getter.type.resultType) : getter.type.resultType,
  );
  if (!getter.hasSetter) return b.method(path, { ...read, getter: returns });
  const { args, returns: noResult, ...write } = createAccessorField(
    new Signature({ args: { value: getter.type }, capability, throws }),
    b.undefined.spec,
  );
  return b.method(path, { ...read, getter: returns, setter: { ...write, value: args.value } });
}

function collectBuiltin(type: ClassType, builtin: Builtin, path: BuiltinPath): Declaration[] {
  const implementation = b.compiled(`builtins/${type.name}`, builtin.name);
  return setMemberParts(b.method(path, b.otherwiseBy(implementation)), { length: builtin.length });
}

function collectClassMember(type: ClassType, member: ClassMember, path: BuiltinPath, isStatic: boolean): Declaration[] {
  if (member instanceof Getter) return collectGetter(type, member, path);
  if (!(member instanceof FunctionDefinition)) return collectBuiltin(type, member, path);
  const hasPrivateName = member.signatures.some(
    signature => signature instanceof Method && signature.privateSymbol !== undefined,
  );
  if (hasPrivateName) return [];
  // The thunk of a method takes the cell of the receiver, which no form hands over yet.
  if (!isStatic) return collectFunction(member, path, type.parameterType, () => null);
  return collectFunction(member, path, null, signature => methodSymbolName(type, signature as Method));
}

function collectClass(type: ClassType, header: string, { placements }: Joins): Declaration[] {
  const { construct, name } = type;
  const constructorPath = placements.get(cppConstructorSymbol(type));
  const path = constructorPath ?? `%${name}%`;
  const declared = b.class(path, {
    types: constructorPath === undefined ? undefined : [b.exactType(constructorPath)],
    stateHeap: externalStateHeap,
    ...type.columns,
    instanceCppClass: b.cppClass(type.cpp, header),
    hasConstructor: construct !== null,
    construct: construct === null ? undefined : createField(construct, null, b.instance(name).fresh.spec),
  });
  return [
    ...setMemberParts(
      declared.map(declaration => (declaration.declares === "Class" ? { ...declaration, name } : declaration)),
      { length: construct === null ? null : (construct.length ?? construct.requiredCount) },
    ),
    ...type.staticMembers.flatMap(member =>
      collectClassMember(type, member, pathOfClassMember(path, "static", member.name), true),
    ),
    ...type.protoMembers.flatMap(member =>
      collectClassMember(type, member, pathOfClassMember(path, "proto", member.name), false),
    ),
  ];
}

function collectNamespace(namespace: NamespaceDefinition, path: BuiltinPath): Declaration[] {
  return [
    ...b.namespace(path, {}, namespace.columns),
    ...(namespace.call === undefined ? [] : declareFunction(namespace.call, path)),
    ...namespace.functions.flatMap(fn => declareFunction(fn, joinPath([path, fn.name]))),
  ];
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
    if (path === undefined) continue;
    for (const fn of namespace.functions) placedFunctions.add(fn);
    declaredFunctions.push(...namespace.functions);
    declarations.push(...tryCollect(() => collectNamespace(namespace, path)));
  }
  for (const fn of schema.functions) {
    if (placedFunctions.has(fn)) continue;
    const path = findFunctionPath(fn, `${stem}.bind.ts`, joins);
    if (path === null) continue;
    declaredFunctions.push(fn);
    declarations.push(...tryCollect(() => declareFunction(fn, path)));
    if (!joins.nativeBindings.has(path)) continue;
    declarations.push(...b.extend(path, { functionObjectCode: { symbol: cppSymbolOf(fn), header: `Generated${cppNamespace}.h` } }));
  }
  for (const type of schema.types) {
    if (!(type instanceof ClassType)) continue;
    declarations.push(...tryCollect(() => collectClass(type, `Generated${cppNamespace}.h`, joins)));
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

export async function collectBindgen(
  bunRoot: string,
  sources: readonly string[],
  placements: ReadonlyMap<string, BuiltinPath>,
  problems: Problems,
): Promise<SourcedDeclaration[]> {
  const joins: Joins = { placements, nativeBindings: findNativeBindings() };
  const collected: SourcedDeclaration[] = [];
  for (const source of [...sources].sort(compareBytes)) {
    const file = relative(bunRoot, source.slice(source.indexOf("=") + 1))
      .split(sep)
      .join("/");
    const schema = await loadSchemaFile(source).catch((error: Error) => {
      problems.add(null, error.message);
      return null;
    });
    if (schema === null) continue;
    const report = (message: string) =>
      problems.add({ file, line: null, origin: "Host", proof: "ByConstruction" }, message);
    collected.push(...createSourcedDeclarations(file, collectSchema(schema, joins, report)));
  }
  return collected;
}
