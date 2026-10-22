import { join } from "node:path";
import {
  declaredTypeOf,
  InvalidThisBehavior,
  isCheckedAtRuntime,
  parseDeclaredType,
  type ClassDefinition,
  type DeclaredAlternative,
  type Field,
} from "../class-definitions.ts";
import {
  GeneratorError,
  type Declaration,
  type MemberDeclaration,
  type Problems,
  type SourcedDeclaration,
} from "./declarations.ts";
import * as b from "./lib.ts";
import { compareBytes, joinPath, pathOfClassMember, symbolPrefix } from "./paths.ts";
import {
  realmParameter,
  type BuiltinPath,
  type DirectEntrySpec,
  type EntryColumns,
  type Heap,
  type OperandName,
  type TypeSpec,
  type UseSpec,
} from "./vocabulary.ts";

type GetterField = Extract<Field, { getter: string }>;
type SetterField = Extract<Field, { setter: string }>;
type FunctionField = Extract<Field, { fn: string }>;
type Side = "static" | "proto";

interface MemberSite {
  definition: ClassDefinition;
  side: Side;
  key: string;
  path: BuiltinPath;
}

const classDefinitionGlob = "src/**/*.classes.ts";
const generatedClassesHeader = "ZigGeneratedClasses.h";
const restParameterName = "operands";

export const externalStateHeap: Heap = "ExternalState";
export const externalState: readonly Heap[] = [externalStateHeap];

const heldValuesAnswered = b.reachableValuesStoredIn(b.result);

export const usesWithoutJavaScript: readonly UseSpec[] = [
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

const jsonSerializationUses: readonly UseSpec[] = [b.runsTransitively("OwnKeys", "OwnValues", "ToJSON", "ToPrimitive")];

const alternativeTypes: Readonly<Record<Exclude<DeclaredAlternative, { instance: string }>, b.TableType>> = {
  string: b.string,
  number: b.f64,
  int32: b.i32,
  bigint: b.bigint,
  boolean: b.bool,
  undefined: b.undefined,
  null: b.strictNull,
  object: b.object,
  Promise: b.instance("Promise"),
  this: b.operand("this"),
};

const cppClassOf = (name: string): string => `JS${name}`;
const labelOf = ({ definition, key }: MemberSite): string => `${definition.name}.${key}`;
const positionalName = (index: number): OperandName => `argument${index}`;

export function createSourcedDeclarations(file: string, declarations: readonly Declaration[]): SourcedDeclaration[] {
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

export function setMemberParts(
  declarations: readonly Declaration[],
  parts: Partial<Pick<MemberDeclaration, "length" | "dispatches">>,
): Declaration[] {
  return declarations.map(declaration => (declaration.declares === "Member" ? { ...declaration, ...parts } : declaration));
}

export function loadClassDefinitions(bunRoot: string): ClassDefinition[] {
  const files = [...new Bun.Glob(classDefinitionGlob).scanSync({ cwd: bunRoot })].sort(compareBytes);
  const classes = files.flatMap((file): ClassDefinition[] => {
    const definitions = require(join(bunRoot, file)).default;
    if (!Array.isArray(definitions) || definitions.length === 0) {
      throw new GeneratorError(`${file}: expected a default export with a non-empty array of classes`);
    }
    return definitions;
  });
  classes.sort((left, right) => compareBytes(left.name, right.name));
  classes.forEach((definition, index) => {
    if (index > 0 && classes[index - 1].name === definition.name) {
      throw new GeneratorError(`two classes are named ${definition.name}`);
    }
  });
  return classes;
}

const hasInstanceReceiver = (definition: ClassDefinition): boolean => !definition.forBind;

function prototypeBaseOf(definition: ClassDefinition): BuiltinPath | null {
  if (definition.forBind) return "Function.prototype";
  return definition.prototypeBase === "Error" ? "Error.prototype" : null;
}

const typeOfAlternative = (alternative: DeclaredAlternative): b.TableType =>
  typeof alternative === "object" ? b.instance(alternative.instance) : alternativeTypes[alternative];

function parseAlternatives(label: string, text: string, problems: Problems): DeclaredAlternative[] | null {
  try {
    return parseDeclaredType(text);
  } catch (error) {
    problems.add(null, `${label}: ${(error as Error).message}`);
    return null;
  }
}

function resolveDeclaredType(label: string, text: string, problems: Problems): b.TableType {
  const alternatives = parseAlternatives(label, text, problems);
  if (alternatives === null) return b.any;
  const [first, ...others] = alternatives.map(typeOfAlternative);
  return b.union(first, ...others);
}

export function typeOfDeclaredText(label: string, text: string, problems: Problems): TypeSpec {
  return resolveDeclaredType(label, text, problems).spec;
}

function mayBeObject(alternative: DeclaredAlternative): boolean {
  switch (alternative) {
    case "string":
    case "number":
    case "int32":
    case "bigint":
    case "boolean":
    case "undefined":
    case "null":
      return false;
    default:
      return true;
  }
}

// A getter that runs no JavaScript. One whose type holds no object answers nothing that it found in its receiver.
function usesOfGetterReceiver(passesWrapper: boolean, declaredText: string | undefined): readonly UseSpec[] {
  const uses = passesWrapper ? usesWithoutJavaScript : usesOfGetterWithoutWrapper;
  if (declaredText === undefined || parseDeclaredType(declaredText).some(mayBeObject)) return uses;
  return uses.filter(use => !usesThatReachResult.includes(use));
}

function isConfigurable(definition: ClassDefinition, field: Field): boolean {
  return ("configurable" in field ? field.configurable : undefined) ?? definition.configurable ?? false;
}

function cachedGetterMember(definition: ClassDefinition, key: string, field: GetterField): string | null {
  if (!field.cache || !hasInstanceReceiver(definition)) return null;
  const member = typeof field.cache === "string" ? field.cache : key;
  const mayBeRedefined = isConfigurable(definition, field);
  return mayBeRedefined ? null : member;
}

// The getter in the table takes what its receiver wraps out of it and calls this function of Rust, which renderDecls() of
// generate-classes.ts declares so. The getter does more for some, and those are not entered without it: it keeps the answer of
// one that is cached, and it is what holds one that is checked at run time to its declared type.
function directEntryOfGetter(definition: ClassDefinition, field: GetterField): DirectEntrySpec | undefined {
  if (field.cache || isCheckedAtRuntime(field)) return undefined;
  const symbol = `${definition.name}Prototype__${field.getter.replaceAll(symbolPrefix, "")}`;
  const receiver = field.this ? " JSC::EncodedJSValue thisValue," : "";
  return {
    symbol,
    declaration: `extern "C" SYSV_ABI JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ${symbol}(void* ptr,${receiver} JSC::JSGlobalObject* lexicalGlobalObject);`,
    headers: [generatedClassesHeader],
    parameters: [
      { value: "NativeObjectOfReceiver", cppType: "void*" },
      ...(field.this ? [{ value: "Receiver", cppType: "JSC::EncodedJSValue" } as const] : []),
      realmParameter,
    ],
    offsetOfNativeObject: `WebCore::${cppClassOf(definition.name)}::offsetOfWrapped()`,
  };
}

const classesReadingMoreOfFrame = new Set(["CronJob", "DoneCallback", "Expect", "ExpectStatic", "ExpectTypeOf", "ScopeFunctions"]);

function directEntryOfMethod({ definition, side }: MemberSite, field: FunctionField): DirectEntrySpec | undefined {
  if (side !== "proto" || !hasInstanceReceiver(definition) || classesReadingMoreOfFrame.has(definition.name)) return undefined;
  if ((field.invalidThisBehavior ?? InvalidThisBehavior.Throw) !== InvalidThisBehavior.Throw) return undefined;
  const symbol = `${definition.name}Prototype__${field.fn.replaceAll(symbolPrefix, "")}`;
  const receiver = field.passThis ? ", JSC::EncodedJSValue thisValue" : "";
  return {
    symbol,
    declaration: `extern "C" SYSV_ABI JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ${symbol}(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame${receiver});`,
    headers: [generatedClassesHeader],
    parameters: [
      { value: "NativeObjectOfReceiver", cppType: "void*" },
      realmParameter,
      { value: "FrameOfValues", cppType: "JSC::CallFrame*" },
      ...(field.passThis ? [{ value: "Receiver", cppType: "JSC::EncodedJSValue" } as const] : []),
    ],
    offsetOfNativeObject: `WebCore::${cppClassOf(definition.name)}::offsetOfWrapped()`,
  };
}

// The setter in the table does the same for a store. The function of Rust answers whether it threw nothing, which compiled code asks the engine, so what is entered
// hands back what a store leaves: nothing.
function directEntryOfSetter(definition: ClassDefinition, field: SetterField): DirectEntrySpec {
  const native = `${definition.name}Prototype__${field.setter.replaceAll(symbolPrefix, "")}`;
  const symbol = `AOT__${native}`;
  const receiver = field.this ? " JSC::EncodedJSValue thisValue," : "";
  const parameters = `(void* ptr,${receiver} JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue value)`;
  return {
    symbol,
    declaration: [
      `extern "C" SYSV_ABI bool JSC_HOST_CALL_ATTRIBUTES ${native}${parameters};`,
      `static SYSV_ABI JSC::EncodedJSValue ${symbol}${parameters}`,
      `{`,
      `    ${native}(ptr,${field.this ? " thisValue," : ""} lexicalGlobalObject, value);`,
      `    return JSC::JSValue::encode(JSC::jsUndefined());`,
      `}`,
    ].join("\n"),
    headers: [generatedClassesHeader],
    parameters: [
      { value: "NativeObjectOfReceiver", cppType: "void*" },
      ...(field.this ? [{ value: "Receiver", cppType: "JSC::EncodedJSValue" } as const] : []),
      realmParameter,
      { value: "Value", cppType: "JSC::EncodedJSValue" },
    ],
    offsetOfNativeObject: `WebCore::${cppClassOf(definition.name)}::offsetOfWrapped()`,
  };
}

function checkPureGetter(site: MemberSite, field: GetterField, problems: Problems): void {
  const declaredText = declaredTypeOf(field);
  if (field.cache) problems.add(null, `${labelOf(site)}: the getter of the table stores what a cached getter answers, so it is not pure`);
  if (declaredText === undefined || isCheckedAtRuntime(field)) {
    problems.add(null, `${labelOf(site)}: a pure getter has a type that the return type of its Rust method proves`);
  } else if (parseDeclaredType(declaredText).some(alternative => alternative === "string" || alternative === "bigint" || mayBeObject(alternative))) {
    problems.add(null, `${labelOf(site)}: a pure getter allocates nothing, so '${declaredText}' is not what it answers`);
  }
}

// The class generator puts the getter into the static table of the prototype under this name. The table has no symbol keys.
// The function takes its receiver for an instance without a test: the engine tests that before it enters a getter of the table.
function symbolColumnsOfGetter(
  { definition, side, key }: MemberSite,
  field: GetterField,
  nativeSymbols: readonly string[] = [],
): Pick<EntryColumns, "nativeSymbols" | "customGetter" | "directEntryOfGetter" | "directEntryOfSetter"> {
  if (side !== "proto" || !hasInstanceReceiver(definition) || key.startsWith(symbolPrefix)) return {};
  const symbol = `${definition.name}Prototype__${key}GetterWrap`;
  return {
    nativeSymbols: [...nativeSymbols, symbol],
    customGetter: symbol,
    directEntryOfGetter: directEntryOfGetter(definition, field),
    // A store is resolved only where the accessor cannot be replaced.
    directEntryOfSetter: definition.lockedPrototype && "setter" in field ? directEntryOfSetter(definition, field as SetterField) : undefined,
  };
}

function isHiddenField(field: Field): boolean {
  return "internal" in field || "value" in field || "privateSymbol" in field || "publicSymbol" in field;
}

function declareMember({ side, path }: MemberSite, field: b.Field): Declaration[] {
  return side === "proto" ? b.method(path, field) : b.static(path, field);
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

function createParameters(positionalCount: number): Record<string, b.TableType> {
  const positional = Array.from({ length: positionalCount }, (_, index): [string, b.TableType] => [
    positionalName(index),
    b.any.optional,
  ]);
  return { ...Object.fromEntries(positional), [restParameterName]: b.any.rest };
}

/** The row of a prototype's function of which a generator other than generate-classes.ts declares and checks the result. */
export function methodReturning(declaredText: string): b.FunctionField {
  const [first, ...others] = parseDeclaredType(declaredText).map(typeOfAlternative);
  const parameters = createParameters(0);
  return {
    args: parameters,
    returns: b.union(first, ...others),
    capability: "js",
    throws: true,
    uses: Object.fromEntries(["this", ...Object.keys(parameters)].map(operand => [operand, b.handedOver])),
    implementation: b.hostCall,
  };
}

// Whoever declares what a function returns or a getter answers has read it, its setter too, and writes `uses` for an operand that it changes.
function usesOfOperandsHandedOver(
  { side }: MemberSite,
  parameters: readonly string[],
): Record<OperandName, readonly UseSpec[]> {
  const operands = side === "proto" ? ["this", ...parameters] : parameters;
  return Object.fromEntries(operands.map(operand => [operand, b.handedOver]));
}

function findTextArgument(site: MemberSite, field: FunctionField, problems: Problems): number | null {
  const argument = field.jsonTextForm?.argument;
  if (argument === undefined) return null;
  if (typeof argument === "number") return argument;
  problems.add(null, `${labelOf(site)}: a class definition names no parameters, so jsonTextForm takes an argument index`);
  return null;
}

function collectFunction(site: MemberSite, field: FunctionField, problems: Problems): Declaration[] {
  const {
    fn,
    async: isAsync,
    length = 0,
    passThis,
    this: passesThis,
    invalidThisBehavior,
    returns,
    checkedAtRuntime,
    enumerable,
    configurable,
    privateSymbol,
    publicSymbol,
    name,
    ...columns
  }: FunctionField & { this?: boolean } = field;
  const parts = { length: site.key.startsWith(symbolPrefix) ? null : length };
  const declaredText = declaredTypeOf(field);
  const directEntry = directEntryOfMethod(site, field);
  if (declaredText === undefined && Object.keys(columns).length === 0) {
    if (directEntry === undefined) return setMemberParts(declareMember(site, b.otherwiseBy(b.hostCall)), parts);
    const operands = createParameters(0);
    const entered: b.FunctionField = {
      args: operands,
      returns: b.any,
      capability: "js",
      throws: true,
      uses: Object.fromEntries(["this", ...Object.keys(operands)].map(operand => [operand, [b.everything]])),
      implementation: b.hostCall,
      directEntryOfMethod: directEntry,
    };
    return setMemberParts(declareMember(site, [entered, b.otherwiseBy(b.hostCall)]), parts);
  }
  const ignoresOtherReceivers = site.side === "proto" && invalidThisBehavior === InvalidThisBehavior.NoOp;
  const declared = declaredText === undefined ? b.any : resolveDeclaredType(labelOf(site), declaredText, problems);
  const textArgument = findTextArgument(site, field, problems);
  const parameters = createParameters(textArgument === null ? 0 : textArgument + 1);
  const signature: b.FunctionField = {
    ...columns,
    this: ignoresOtherReceivers ? b.any : undefined,
    args: parameters,
    returns: ignoresOtherReceivers ? b.union(declared, b.undefined) : declared,
    capability: "js",
    throws: true,
    uses: {
      ...(declaredText === undefined ? {} : usesOfOperandsHandedOver(site, Object.keys(parameters))),
      ...(textArgument === null ? {} : { [positionalName(textArgument)]: jsonSerializationUses }),
      ...columns.uses,
    },
    implementation: columns.implementation ?? b.hostCall,
    directEntryOfMethod: directEntry,
  };
  return setMemberParts(declareMember(site, signature), parts);
}

function collectAccessor(site: MemberSite, field: GetterField | SetterField, problems: Problems): Declaration[] {
  const { definition, side, key, path } = site;
  const {
    getter,
    setter,
    cache,
    type,
    checkedAtRuntime,
    writable,
    this: passesThis,
    pure: isPure = false,
    enumerable,
    configurable,
    privateSymbol,
    publicSymbol,
    name,
    ...columns
  }: Partial<GetterField & SetterField> = field;
  const cachedMember = side === "proto" && "getter" in field ? cachedGetterMember(definition, key, field) : null;
  const declaredText = declaredTypeOf(field);
  const runsNoJavaScript = declaredText !== undefined || cachedMember !== null;
  if (getter === undefined) return [createStructureMember(path, "Accessor", null)];
  if (isPure) checkPureGetter(site, field as GetterField, problems);
  const symbolColumns = symbolColumnsOfGetter(site, field as GetterField, columns.nativeSymbols);
  if (!runsNoJavaScript && Object.keys(columns).length === 0) {
    return [createStructureMember(path, "Accessor", null, symbolColumns)];
  }
  const isStable = cachedMember !== null && !definition.lockedPrototype;
  return declareMember(site, {
    ...columns,
    ...symbolColumns,
    getter: declaredText === undefined ? b.any : resolveDeclaredType(labelOf(site), declaredText, problems),
    setter:
      setter !== undefined || writable
        ? {
            value: b.any,
            capability: "js",
            throws: true,
            uses: declaredText === undefined ? undefined : usesOfOperandsHandedOver(site, ["value"]),
          }
        : undefined,
    capability: isPure ? "none" : runsNoJavaScript ? "heap" : "js",
    throws: !isPure,
    uses: isPure
      ? { this: [b.readsContents()], ...columns.uses }
      : runsNoJavaScript
        ? { this: usesOfGetterReceiver(passesThis === true, declaredText), ...columns.uses }
        : columns.uses,
    reads: columns.reads ?? externalState,
    writes: columns.writes ?? (isPure ? [] : externalState),
    implementation:
      cachedMember === null
        ? columns.implementation
        : { how: "CachedGetter", cppClass: cppClassOf(definition.name), member: `m_${cachedMember}` },
    mutability: columns.mutability ?? (isStable ? "ConstantUnlessWritten" : undefined),
  });
}

function collectMember(site: MemberSite, field: Field, problems: Problems): Declaration[] {
  if (isHiddenField(field)) return [];
  if ("jsonTextForm" in field && (site.side === "proto" || !("fn" in field))) {
    problems.add(null, `${labelOf(site)}: jsonTextForm belongs on a static function`);
    return [];
  }
  if ("fn" in field) return collectFunction(site, field, problems);
  if ("builtin" in field) {
    return [createStructureMember(site.path, site.side === "proto" ? "Method" : "Function", field.length ?? 0)];
  }
  if ("getter" in field || "setter" in field) return collectAccessor(site, field, problems);
  problems.add(null, `${labelOf(site)}: a member is a function, a getter or a setter`);
  return [];
}

function collectClass(definition: ClassDefinition, problems: Problems): Declaration[] {
  const { name } = definition;
  const path: BuiltinPath = `%${name}%`;
  const hasConstructor = !definition.noConstructor;
  const prototypeBase = prototypeBaseOf(definition);
  const instance = b.instance(name);
  const collectMembers = (side: Side, fields: Readonly<Record<string, Field>>): Declaration[] =>
    Object.keys(fields)
      .sort(compareBytes)
      .flatMap(key =>
        collectMember({ definition, side, key, path: pathOfClassMember(path, side, key) }, fields[key], problems),
      );
  return [
    ...b.class(path, {
      instanceCppClass: hasInstanceReceiver(definition)
        ? b.cppClass(cppClassOf(name), generatedClassesHeader)
        : undefined,
      prototypeCppExpression: hasInstanceReceiver(definition)
        ? `globalObject->${cppClassOf(name)}Prototype()`
        : undefined,
      instanceStructureCppExpression: definition.lockedPrototype || hasInstanceReceiver(definition)
        ? `globalObject->m_generatedLazyClasses[Zig::GlobalObject::GeneratedLazyClass${cppClassOf(name)}].getConcurrently()`
        : undefined,
      hasConstructor,
      lockedObjects: definition.lockedPrototype ? ["prototype"] : [],
      slots: definition.slots,
      stateHeap: definition.stateHeap ?? externalStateHeap,
      types: definition.types,
      construct:
        definition.construct && hasConstructor
          ? {
              args: createParameters(0),
              returns: definition.constructNeedsThis ? instance : instance.fresh,
              capability: "js",
              throws: true,
              implementation: b.hostCall,
            }
          : undefined,
    }),
    ...(prototypeBase === null ? [] : b.inherits(joinPath([path, "prototype"]), prototypeBase)),
    ...collectMembers("proto", definition.proto),
    ...(hasConstructor ? collectMembers("static", definition.klass) : []),
  ];
}

export function collectClasses(classes: readonly ClassDefinition[], problems: Problems): SourcedDeclaration[] {
  return createSourcedDeclarations(
    classDefinitionGlob,
    classes.flatMap(definition => collectClass(definition, problems)),
  );
}
