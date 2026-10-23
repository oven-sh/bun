import type { TypeInterner } from "./build-types.ts";
import type {
  ClassDeclaration,
  ConstantSpec,
  Declaration,
  MemberDeclaration,
  NamespaceDeclaration,
  NativeBindingDeclaration,
  OwnPropertiesDeclaration,
  SignatureDeclaration,
  Source,
  SourcedDeclaration,
  TargetTextSpec,
} from "./declarations.ts";
import { canonicalTextOf } from "./dump.ts";
import { customGetterCall } from "./lib.ts";
import {
  addFlag,
  defaultMutabilityOf,
  functionPrototypePath,
  isObjectKind,
  keyOfFunction,
  linkTo,
  type ModelBuilder,
  type MutableBuiltin,
  type MutableClass,
  type MutableFunction,
  type MutableModule,
  type MutableSlot,
  type WrittenEntry,
  type WrittenSignature,
} from "./model-builder.ts";
import {
  noHostNumber,
  targetArchitectures,
  type BuiltinFlag,
  type InstanceTest,
  type ModelBuiltin,
  type ModelClass,
  type ModelConstant,
  type ModelFunction,
  type ModelImplementation,
  type ModelLayout,
  type ModelName,
  type ModelPrototype,
  type ModelRealmStructure,
  type ModelSlot,
  type ModelTargetText,
  type ModelTypeName,
} from "./model.ts";
import {
  compareBytes,
  globalThisPath,
  isHiddenRootComponent,
  joinPath,
  nativeFunctionsPath,
  parsePath,
  pathOfNativeBinding,
  pathOfNativeFunction,
  tokenOf,
} from "./paths.ts";
import {
  builtinMarks,
  pristineTests,
  targetPlatforms,
  type BuiltinKind,
  type BuiltinPath,
  type CallMode,
  type ClassColumns,
  type EntryColumns,
  type Heap,
  type ImplementationSpec,
  type ParameterType,
  type PristineTest,
  type TargetPlatform,
  type TypeSpec,
} from "./vocabulary.ts";

export { isObjectKind, ModelBuilder } from "./model-builder.ts";
export type {
  Mutable,
  MutableBuiltin,
  MutableClass,
  MutableFunction,
  MutableLayout,
  MutableModule,
  MutableName,
  MutableSlot,
  WrittenClass,
  WrittenColumns,
  WrittenEntry,
  WrittenSignature,
} from "./model-builder.ts";

type DeclarationOf<Kind extends Declaration["declares"]> = Extract<Declaration, { declares: Kind }>;
type MemberKind = MemberDeclaration["kind"];
type OwnSlotSpec = Extract<ImplementationSpec, { how: "OwnSlot" }>;

interface Keyed<Declared extends Declaration = Declaration> {
  declaration: Declared;
  source: Source;
  path: string[];
  key: BuiltinPath;
}

interface EntryContext {
  builder: ModelBuilder;
  sorted: readonly Keyed[];
  classesByPath: Map<BuiltinPath, MutableClass>;
  ownPropertyLists: Map<ModelBuiltin, Keyed<OwnPropertiesDeclaration>>;
  structurePlatforms: Map<ModelBuiltin, Set<TargetPlatform>>;
}

const prototypeName = "prototype";
const constructorName = "constructor";
const objectPrototypePath: BuiltinPath = "Object.prototype";
const compilerHelpersPath: BuiltinPath = "%CompilerHelpers%";
const platformsWithoutOwnPropertyDump: readonly TargetPlatform[] = ["Windows", "FreeBSD", "Android"];
const listColumns: ReadonlySet<string> = new Set<keyof EntryColumns>([
  "usesFeature",
  "loads",
  "callsFunctions",
  "nativeSymbols",
  "marks",
]);
const flagColumns = [
  ["requiresHolderAsThis", "RequiresHolderAsThis"],
  ["deterministic", "IsDeterministic"],
  ["privateAlias", "HasPrivateAlias"],
  ["startsInstance", "StartsInstance"],
  ["defaultExport", "IsDefaultExport"],
] as const satisfies readonly (readonly [keyof EntryColumns, BuiltinFlag])[];

function select<Item extends SourcedDeclaration, Kind extends Declaration["declares"]>(
  items: readonly Item[],
  ...kinds: readonly Kind[]
): (Item & { declaration: DeclarationOf<Kind> })[] {
  const wanted: readonly string[] = kinds;
  return items.filter((item): item is Item & { declaration: DeclarationOf<Kind> } =>
    wanted.includes(item.declaration.declares),
  );
}

function compareSources(left: Source, right: Source): number {
  return compareBytes(left.file, right.file) || (left.line ?? 0) - (right.line ?? 0);
}

function columnOf<Column extends keyof EntryColumns>(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  column: Column,
): EntryColumns[Column] {
  return builder.columnsOf(builtin).find(({ columns }) => columns[column] !== undefined)?.columns[column];
}

function pathOfDeclaration(declaration: Declaration): BuiltinPath | null {
  switch (declaration.declares) {
    case "Namespace":
    case "Class":
    case "Member":
    case "Extension":
    case "SameObject":
    case "Inheritance":
      return declaration.path;
    case "StaticTable":
    case "OwnProperties":
      return declaration.holder;
    case "Module":
      return declaration.namespacePath ?? declaration.specifier;
    case "NativeBinding":
      return pathOfNativeBinding(declaration.kind, declaration.file, declaration.symbol);
    case "Layout":
    case "Name":
    case "RuntimeFunction":
    case "NativeLoad":
    case "NativeCalls":
    case "Intrinsic":
    case "ExcludedFunction":
    case "HandwrittenFile":
    case "HostRole":
    case "HostClassRole":
    case "UnfilledHostRoles":
    case "LeftOut":
    case "FrontEndFunction":
    case "EngineFeatures":
    case "HostRead":
    case "HostObject":
    case "NamedMemberCall":
    case "HostMethodCall":
    case "Startup":
    case "SeenCodeOnly":
      return null;
  }
}

function declareRoots(builder: ModelBuilder, declarations: readonly SourcedDeclaration[]): void {
  const modules = select(declarations, "Module")
    .map(({ declaration }) => declaration)
    .sort((left, right) => compareBytes(left.specifier, right.specifier));
  for (const { specifier, namespacePath } of modules) builder.declareRoot(specifier, namespacePath ?? specifier);

  const declaredPaths = new Set<BuiltinPath>();
  for (const { declaration } of select(declarations, "Member")) {
    declaredPaths.add(joinPath(builder.canonicalPathOf(declaration.path)));
  }
  for (const { declaration } of select(declarations, "OwnProperties")) {
    for (const { name } of declaration.properties) {
      declaredPaths.add(joinPath(builder.memberPathOf(declaration.holder, name)));
    }
  }

  const nativeNamespaces = modules
    .filter(module => !module.hasSource)
    .map(module => builder.canonicalPathOf(module.specifier));
  for (const { declaration, source } of select(declarations, "Class")) {
    if (source.origin !== "Host" || declaration.columns.hasConstructor === false) continue;
    const written = parsePath(declaration.path);
    if (written.length !== 1 || !isHiddenRootComponent(written[0])) continue;
    const exposed = [[], ...nativeNamespaces]
      .map(holder => joinPath([...holder, declaration.name]))
      .find(path => declaredPaths.has(path));
    if (exposed !== undefined) builder.declareRoot(declaration.path, exposed);
  }
}

const holderDepthOf = ({ path, key }: Keyed): number => (key === globalThisPath ? 0 : path.length);

function sortDeclarations(builder: ModelBuilder, declarations: readonly SourcedDeclaration[]): Keyed[] {
  return declarations
    .map(({ declaration, source }): Keyed => {
      const written = pathOfDeclaration(declaration);
      const path = written === null ? [] : builder.canonicalPathOf(written);
      return { declaration, source, path, key: joinPath(path) };
    })
    .sort(
      (left, right) =>
        holderDepthOf(left) - holderDepthOf(right) ||
        compareBytes(left.key, right.key) ||
        compareSources(left.source, right.source),
    );
}

function checkGlobalObject({ builder, sorted }: EntryContext): void {
  const namespaces = select(sorted, "Namespace");
  for (const { declaration, source, key } of namespaces) {
    if (declaration.isGlobalObject === (key === globalThisPath)) continue;
    builder.problems.add(
      source,
      declaration.isGlobalObject
        ? `${key} is declared as the global object, whose path is ${globalThisPath}`
        : `${key} is not declared as the global object`,
    );
  }
  if (!namespaces.some(({ key }) => key === globalThisPath)) {
    builder.problems.add(null, `no namespace declares ${globalThisPath}`);
  }
}

function instanceTestOf(columns: ClassColumns): InstanceTest {
  if (columns.instanceCppClass !== undefined) return "ClassInfoInherits";
  if (columns.sharingMode !== undefined) return "SharingModeEquals";
  return columns.jsType === undefined ? "None" : "JSTypeEquals";
}

function pristineTestOf(builder: ModelBuilder, { name, columns }: ClassDeclaration, source: Source): PristineTest {
  const { pristineTest = "Mark" } = columns;
  if (pristineTests.includes(pristineTest)) return pristineTest;
  builder.problems.add(
    source,
    `the class ${name}: ${pristineTest} is not one of the tests ${pristineTests.join(", ")}`,
  );
  return "Mark";
}

function declareClasses({ builder, sorted }: EntryContext): void {
  for (const { declaration, source } of select(sorted, "Class")) {
    const { name, columns } = declaration;
    if (builder.isLeftOut(declaration.path)) continue;
    const builtinClass: MutableClass = {
      id: -1,
      token: tokenOf(parsePath(name)),
      origin: source.origin,
      parent: null,
      constructor: null,
      prototype: null,
      jsType: columns.jsType ?? "CellType",
      typedArrayType: columns.typedArrayType ?? "NotTypedArray",
      instanceTest: instanceTestOf(columns),
      sharingMode: columns.sharingMode ?? null,
      instanceCppClass: columns.instanceCppClass ?? null,
      prototypeCppExpression: columns.prototypeCppExpression ?? null,
      instanceStructureCppExpression: columns.instanceStructureCppExpression ?? null,
      isPrimitiveWrapper: columns.isPrimitiveWrapper ?? false,
      isNeverPristine: columns.isNeverPristine ?? false,
      pristineTest: pristineTestOf(builder, declaration, source),
      hasClosureInstances: columns.hasClosureInstances ?? false,
      instancesAreEntries: columns.instancesAreEntries ?? false,
      definesCharactersOnNewInstances: columns.definesCharactersOnNewInstances ?? false,
      namesDefinedOnNewInstances:
        columns.namesDefinedOnNewInstances?.map(text => builder.internComponent(text)) ?? null,
      typesOfNamesDefinedOnNewInstances: [],
      namesMadeByStaticMembers: Object.entries(columns.namesMadeByStaticMembers ?? {}).map(([name, member]) => ({
        name: builder.internComponent(name),
        member: builder.internComponent(member),
      })),
      constructorOnlyReadsPrototypeOfNewTarget: columns.constructorOnlyReadsPrototypeOfNewTarget ?? false,
      slots: [],
      stateHeap: columns.stateHeap ?? null,
      types: [],
    };
    if (!builder.addClass(name, builtinClass, { declaration, source })) {
      builder.problems.add(source, `the class ${name} is declared twice`);
    }
  }
  for (const builtinClass of builder.classes) {
    const { declaration, source } = builder.writtenClassOf(builtinClass);
    const parentName = declaration.columns.extends;
    if (parentName !== undefined) builtinClass.parent = builder.resolveClass(parentName, source);
  }
}

function createNamespace(
  builder: ModelBuilder,
  declaration: NamespaceDeclaration,
  key: BuiltinPath,
  source: Source,
): void {
  const namespace = builder.create(key, "Namespace", source);
  if (namespace === null) return;
  if (declaration.scope === "Module") namespace.scope = "Module";
  if (declaration.isLocked) addFlag(namespace, "IsLockedObject");
  if (declaration.locksMembers) addFlag(namespace, "HasLockedMembers");
  if (declaration.isGlobalObject) addFlag(namespace, "IsGlobalObject");
  if (declaration.listsAllMembers) addFlag(namespace, "ListsAllMembers");
  const { namesReadByNativeCode, namesOnlyInspectedByNativeCode } = declaration;
  if (namesReadByNativeCode !== null) {
    builder.namesReadByNativeCode.set(namespace, {
      names: namesReadByNativeCode.map(name => builder.internComponent(name)),
      namesOnlyInspected: namesOnlyInspectedByNativeCode.map(name => builder.internComponent(name)),
    });
  } else if (namesOnlyInspectedByNativeCode.length > 0) {
    builder.problems.add(
      source,
      `${key} says which names native code only inspects and does not list the names that it reads`,
    );
  }
}

function createClassObjects(
  { builder, classesByPath }: EntryContext,
  declaration: ClassDeclaration,
  key: BuiltinPath,
  source: Source,
): void {
  const builtinClass = builder.findClass(declaration.name);
  if (builtinClass === undefined || builder.writtenClassOf(builtinClass).declaration !== declaration) return;
  classesByPath.set(key, builtinClass);
  const { hasConstructor = true, hasPrototype = true, constructorHoldsPrototype = true } = declaration.columns;
  const { lockedObjects = [], lockedMembers = [], closedToOtherNames = [] } = declaration.columns;
  const { openNamesOfPrototype = [], openNamesOfConstructor = [] } = declaration.columns;
  const entryColumns = Object.keys(declaration.entryColumns).join(", ");
  if (!hasConstructor && !hasPrototype && entryColumns !== "") {
    builder.problems.add(source, `${key} has neither a constructor nor a prototype to take ${entryColumns}`);
  }
  const classConstructor = hasConstructor ? builder.create(key, "Constructor", source) : null;
  if (hasConstructor && classConstructor === null) return;
  const prototype = hasPrototype
    ? builder.create(joinPath([key, prototypeName]), "Prototype", source, !hasConstructor || !constructorHoldsPrototype)
    : null;
  builtinClass.constructor = classConstructor;
  builtinClass.prototype = prototype;
  if (classConstructor !== null) classConstructor.instanceClass = builtinClass;
  if (prototype !== null) prototype.instanceClass = builtinClass;
  for (const [sides, flag] of [
    [lockedObjects, "IsLockedObject"],
    [lockedMembers, "HasLockedMembers"],
    [closedToOtherNames, "IsClosedToOtherNames"],
  ] as const) {
    for (const side of sides) {
      const locked = side === "constructor" ? classConstructor : prototype;
      if (locked !== null) addFlag(locked, flag);
      else builder.problems.add(source, `the class ${declaration.name} locks its ${side} and has none`);
    }
  }
  for (const [side, holder, openNames] of [
    ["prototype", prototype, openNamesOfPrototype],
    ["constructor", classConstructor, openNamesOfConstructor],
  ] as const) {
    if (openNames.length === 0) continue;
    if (holder !== null && lockedMembers.includes(side)) {
      builder.openNames.set(
        holder,
        openNames.map(name => builder.internComponent(name)),
      );
    } else {
      const problem = `the class ${declaration.name} names open keys of a ${side} whose members it does not lock`;
      builder.problems.add(source, problem);
    }
  }
}

function createNativeBinding(
  builder: ModelBuilder,
  { file, symbol, hostNumber, answersFunction, isHandedByNativeCode }: NativeBindingDeclaration,
  key: BuiltinPath,
  source: Source,
): void {
  if (hostNumber === null && isHandedByNativeCode !== true) return;
  const binding = builder.create(key, "NativeBinding", source, true);
  if (binding === null) return;
  binding.hostNumber = hostNumber ?? noHostNumber;
  if (!answersFunction) return;
  const holder = builder.find(nativeFunctionsPath) ?? builder.create(nativeFunctionsPath, "Namespace", source);
  if (holder === null) return;
  holder.scope = "Module";
  const made = builder.create(pathOfNativeFunction(file, symbol), "Function", source);
  if (made !== null) builder.bindingsOfFunctions.set(made, binding);
}

function createObjects(context: EntryContext): void {
  const { builder, sorted } = context;
  const declaredObjectKeys = new Set(select(sorted, "Namespace", "Class").map(({ key }) => key));
  for (const { declaration, source, key } of select(sorted, "Namespace", "Class", "Module", "NativeBinding")) {
    switch (declaration.declares) {
      case "Namespace":
        createNamespace(builder, declaration, key, source);
        break;
      case "Class":
        createClassObjects(context, declaration, key, source);
        break;
      case "Module":
        if (declaration.namespacePath !== null || declaredObjectKeys.has(key) || builder.find(key) !== undefined) break;
        builder.create(key, "Namespace", source);
        break;
      case "NativeBinding":
        createNativeBinding(builder, declaration, key, source);
        break;
    }
  }
}

function registerModules({ builder, sorted }: EntryContext): void {
  for (const { declaration, source, key } of select(sorted, "Module")) {
    const namespace = builder.resolve(key, source);
    if (namespace === null) continue;
    const { specifier, registryId, hasSource, isEsModule, hasOpenNamespace, listsAllExports, isPublic } = declaration;
    if (!isObjectKind(namespace.kind)) {
      builder.problems.add(source, `the namespace of ${specifier} is ${namespace.text}, which is a ${namespace.kind}`);
      continue;
    }
    const module: MutableModule = {
      id: registryId,
      token: tokenOf([specifier]),
      specifier,
      hasSource,
      isEsModule,
      hasOpenNamespace,
      listsAllExports,
      isPublic,
      namespace,
      exportsHeldByNamespace: declaration.exportsHeldByNamespace.map(name => builder.internComponent(name)),
    };
    if (!builder.addModule(module)) builder.problems.add(source, `the module ${specifier} is declared twice`);
  }
}

function resolveKindsOfModuleObjects({ builder, sorted }: EntryContext): void {
  for (const { declaration, source, key } of select(sorted, "Module")) {
    const moduleObject = builder.find(key);
    if (moduleObject === undefined || declaration.isFunction === null) continue;
    if (declaration.isFunction && moduleObject.kind === "Namespace") {
      moduleObject.kind = "Constructor";
      builder.functionsOfUnknownClass.add(moduleObject);
    }
    const isCallable = moduleObject.kind === "Constructor" || moduleObject.kind === "Function";
    if (declaration.isFunction === isCallable) continue;
    builder.problems.add(
      source,
      `require("${declaration.specifier}") answers no function, and it is a ${moduleObject.kind}`,
    );
  }
}

function closeModuleNamespaces(builder: ModelBuilder): void {
  for (const module of builder.modules) {
    const namespace = builder.find(joinPath(module.namespace.path));
    if (namespace === undefined || namespace.kind !== "Namespace" || !module.listsAllExports) continue;
    addFlag(namespace, "ListsAllMembers");
  }
}

const isStructureOnly = ({ declaration }: Keyed<MemberDeclaration>): boolean =>
  declaration.signatures.length === 0 && declaration.constant === null;

function findAgreedKind(
  builder: ModelBuilder,
  key: BuiltinPath,
  members: readonly Keyed<MemberDeclaration>[],
): MemberKind | undefined {
  const [first] = members;
  for (const { declaration, source } of members) {
    if (declaration.kind === first.declaration.kind) continue;
    builder.problems.add(
      source,
      `${key} is declared as ${declaration.kind}, and as ${first.declaration.kind} in ${first.source.file}`,
    );
  }
  return first?.declaration.kind;
}

function mergeKinds(objectKind: BuiltinKind, memberKind: MemberKind): BuiltinKind | null {
  switch (objectKind) {
    case "Namespace":
      return memberKind === "Function" || memberKind === "Constructor" ? memberKind : null;
    case "NativeBinding":
      return memberKind === "Function" || memberKind === "Accessor" ? objectKind : null;
    case "Prototype":
      return memberKind === "Function" ? objectKind : null;
    case "Constructor":
    case "Function":
    case "Method":
    case "Accessor":
    case "DataProperty":
    case "Constant":
      return memberKind === objectKind ? objectKind : null;
  }
}

// A getter says what the binding answers. A function says what the functions in the answer do that have no entry of their own.
function checkRowsOfNativeBinding(
  builder: ModelBuilder,
  key: BuiltinPath,
  declared: readonly Keyed<MemberDeclaration>[],
): void {
  for (const { declaration, source } of declared) {
    if (mergeKinds("NativeBinding", declaration.kind) !== null) continue;
    builder.problems.add(source, `${key} is declared as NativeBinding and as ${declaration.kind}`);
  }
}

function resolveKind(
  builder: ModelBuilder,
  key: BuiltinPath,
  objectKind: BuiltinKind | undefined,
  members: readonly Keyed<MemberDeclaration>[],
): BuiltinKind {
  const declared = members.filter(member => !isStructureOnly(member));
  if (objectKind === "NativeBinding") {
    checkRowsOfNativeBinding(builder, key, declared);
    return objectKind;
  }
  const structural = members.filter(member => isStructureOnly(member) && member.declaration.kind !== "DataProperty");
  const written = findAgreedKind(builder, key, declared);
  const fromStructure = findAgreedKind(builder, key, structural);
  if (objectKind === undefined) return written ?? fromStructure ?? "DataProperty";
  if (written === undefined) return objectKind;
  const merged = mergeKinds(objectKind, written);
  if (merged !== null) return merged;
  builder.problems.add(members[0].source, `${key} is declared as ${objectKind} and as ${written}`);
  return objectKind;
}

// The table has one record for each text. What is written differs either by platform or by architecture.
function resolveTargetTexts(builder: ModelBuilder, written: readonly TargetTextSpec[]): ModelTargetText[] {
  return Array.from(
    Map.groupBy(written, ({ text }) => text),
    ([text, specs]) => ({
      platforms: targetPlatforms.filter(platform => specs.some(spec => spec.platforms.includes(platform))),
      architectures: targetArchitectures.filter(architecture =>
        specs.some(spec => spec.architectures.includes(architecture)),
      ),
      text: builder.internName(text, "Text"),
    }),
  );
}

function resolveConstant(builder: ModelBuilder, builtin: ModelBuiltin, constant: ConstantSpec): ModelConstant {
  switch (constant.constant) {
    case "Number": {
      const { value, cppExpression } = constant;
      if (cppExpression !== null) builder.checkedNumbers.push({ value, cppExpression });
      return constant;
    }
    case "String":
      return { constant: "String", texts: resolveTargetTexts(builder, constant.texts) };
    case "Symbol":
      return { constant: "Symbol", name: builder.internName(builtin.name.text, "WellKnownSymbol") };
    case "Undefined":
      return constant;
  }
}

function mergeMembers(
  builder: ModelBuilder,
  builtin: MutableBuiltin,
  members: readonly Keyed<MemberDeclaration>[],
): void {
  const written = builder.writtenEntryOf(builtin);
  const sourceOfMode = new Map<CallMode, Source>();
  // A class definition names no parameters, so a signature written by hand takes the place of the one derived from it.
  const isReplaced = (mode: CallMode, source: Source): boolean =>
    source.proof === "ByConstruction" && sourceOfMode.get(mode)?.proof === "HandWritten";
  const handWrittenFirst = members.toSorted(
    (left, right) => Number(right.source.proof === "HandWritten") - Number(left.source.proof === "HandWritten"),
  );
  // The result that the definition declares is proven or checked where the value leaves native code, whatever the operands were.
  const resultsByConstruction = new Map<CallMode, TypeSpec>();
  // Where nothing proves the result that the definition declares, nothing proves what a signature written by hand says of the same native code.
  const modesDeclaredOnly = new Set<CallMode>();
  for (const { declaration, source } of members) {
    if (source.proof !== "ByConstruction") continue;
    for (const { mode, result, isUndeclared, resultIsDeclaredOnly } of declaration.signatures) {
      if (!isUndeclared && result.type !== "Anything") resultsByConstruction.set(mode, result);
      if (resultIsDeclaredOnly) modesDeclaredOnly.add(mode);
    }
  }
  const withDeclaredResult = (written: SignatureDeclaration): SignatureDeclaration => {
    const signature =
      modesDeclaredOnly.has(written.mode) && !written.isUndeclared
        ? { ...written, resultIsDeclaredOnly: true }
        : written;
    const result = resultsByConstruction.get(signature.mode);
    const saysNothing = signature.result.type === "Anything" && signature.result.freshness === undefined;
    return result === undefined || !saysNothing || signature.isUndeclared ? signature : { ...signature, result };
  };
  for (const { declaration, source } of handWrittenFirst) {
    if (declaration.isOwnPropertyOfInstances) addFlag(builtin, "IsOwnPropertyOfInstances");
    if (declaration.isLazilyCreated) addFlag(builtin, "IsLazilyCreated");
    written.length ??= declaration.length;
    const signatures = declaration.signatures.filter(signature => !isReplaced(signature.mode, source));
    const modes = new Set(signatures.map(signature => signature.mode));
    if (declaration.constant !== null) modes.add("Get");
    const [earlier] = [...modes].flatMap(mode => sourceOfMode.get(mode) ?? []);
    if (earlier !== undefined) {
      builder.problems.add(source, `${builtin.text} is declared in ${earlier.file} and in ${source.file}`);
      continue;
    }
    for (const mode of modes) sourceOfMode.set(mode, source);
    for (const signature of signatures) written.signatures.push({ signature: withDeclaredResult(signature), source });
    if (declaration.constant !== null) builtin.constant = resolveConstant(builder, builtin, declaration.constant);
  }
}

function createMembers({ builder, sorted }: EntryContext): void {
  for (const [key, members] of Map.groupBy(select(sorted, "Member"), member => member.key)) {
    const existing = builder.find(key);
    const kind = resolveKind(builder, key, existing?.kind, members);
    const builtin = existing ?? builder.create(key, kind, members[0].source);
    if (builtin === null) continue;
    builtin.kind = kind;
    mergeMembers(builder, builtin, members);
  }
}

function createOwnProperties({ builder, sorted, ownPropertyLists }: EntryContext): void {
  for (const list of select(sorted, "OwnProperties")) {
    const { declaration, source, key } = list;
    const holder = builder.resolve(key, source);
    if (holder === null) continue;
    if (ownPropertyLists.has(holder)) {
      builder.problems.add(source, `${holder.text} has two lists of own properties`);
      continue;
    }
    ownPropertyLists.set(holder, list);
    if (!declaration.isOpen) addFlag(holder, "ListsAllMembers");
    for (const { name, isAccessor, isFixed } of declaration.properties) {
      const path = joinPath(builder.memberPathOf(key, name));
      const property = builder.find(path) ?? builder.create(path, isAccessor ? "Accessor" : "DataProperty", source);
      if (isFixed && property !== null) builder.fixedProperties.add(property);
    }
  }
}

function createConstructorProperties(builder: ModelBuilder, originals: Map<ModelBuiltin, ModelBuiltin>): void {
  for (const builtinClass of builder.classes) {
    const { constructor: classConstructor, prototype } = builtinClass;
    if (classConstructor === null || prototype === null) continue;
    const key = joinPath([...prototype.path, constructorName]);
    const existing = builder.find(key);
    if (existing !== undefined) {
      const isDeclared = builder.signaturesOf(existing).length > 0 || existing.constant !== null;
      if (isDeclared || originals.has(existing)) continue;
    }
    const property = existing ?? builder.create(key, "Constructor", builder.writtenClassOf(builtinClass).source);
    if (property !== null) originals.set(property, classConstructor);
  }
}

function findCanonicalObject(
  alias: ModelBuiltin,
  originals: ReadonlyMap<ModelBuiltin, ModelBuiltin>,
): ModelBuiltin | null {
  const visited = new Set<ModelBuiltin>();
  let current = alias;
  for (;;) {
    const original = originals.get(current);
    if (original === undefined) return current;
    if (visited.has(current)) return null;
    visited.add(current);
    current = original;
  }
}

function linkSameObjects({ builder, sorted }: EntryContext): void {
  const declared = select(sorted, "SameObject");
  for (const { key, source } of declared) {
    if (builder.find(key) === undefined) builder.create(key, "DataProperty", source);
  }
  const originals = new Map<ModelBuiltin, ModelBuiltin>();
  for (const { declaration, key, source } of declared) {
    const alias = builder.find(key);
    const original = builder.resolve(declaration.original, source);
    if (alias === undefined || original === null) continue;
    if (source.origin === "Engine") alias.origin = "Engine";
    if (originals.has(alias)) builder.problems.add(source, `${alias.text} is declared the same object as two others`);
    else originals.set(alias, original);
  }
  createConstructorProperties(builder, originals);
  for (const alias of builder.builtins) {
    if (!originals.has(alias)) continue;
    const canonical = findCanonicalObject(alias, originals);
    if (canonical === null) {
      builder.problems.add(builder.sourceOf(alias), `${alias.text} is declared the same object as itself`);
      continue;
    }
    alias.sameObjectAs = canonical;
    alias.kind = canonical.kind;
    alias.instanceClass = canonical.instanceClass;
    if (canonical.flags.includes("IsGlobalObject")) addFlag(alias, "IsGlobalObject");
  }
}

function filterNewItems(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  column: keyof EntryColumns,
  value: unknown,
  source: Source,
): unknown[] {
  const known = new Set(
    builder.columnsOf(builtin).flatMap(({ columns }) => [columns[column] ?? []].flat().map(canonicalTextOf)),
  );
  return [value].flat().filter(item => {
    const text = canonicalTextOf(item);
    const isNew = !known.has(text);
    if (!isNew) builder.problems.add(source, `${builtin.text}: ${column} lists ${text} twice`);
    known.add(text);
    return isNew;
  });
}

function addColumns(builder: ModelBuilder, builtin: ModelBuiltin, columns: EntryColumns, source: Source): void {
  const written = builder.writtenEntryOf(builtin).columns;
  const accepted: EntryColumns = {};
  for (const [name, value] of Object.entries(columns)) {
    if (value === undefined) continue;
    const column = name as keyof EntryColumns;
    if (listColumns.has(column)) {
      Object.assign(accepted, { [column]: filterNewItems(builder, builtin, column, value, source) });
      continue;
    }
    const earlier = written.find(other => other.columns[column] !== undefined);
    if (earlier === undefined) {
      Object.assign(accepted, { [column]: value });
      continue;
    }
    builder.problems.add(
      source,
      `${builtin.text}: ${column} is written in ${earlier.source.file} and in ${source.file}`,
    );
  }
  if (Object.keys(accepted).length > 0) written.push({ columns: accepted, source });
}

function findColumnsOwner({ builder, classesByPath }: EntryContext, key: BuiltinPath): MutableBuiltin | undefined {
  const prototype = classesByPath.get(key)?.prototype ?? null;
  return builder.find(key) ?? (prototype === null ? undefined : builder.find(joinPath(prototype.path)));
}

function addWrittenColumns(context: EntryContext): void {
  const { builder, sorted, structurePlatforms } = context;
  for (const { declaration, source, key } of select(sorted, "Namespace", "Class", "Member", "Extension")) {
    const columns = declaration.declares === "Class" ? declaration.entryColumns : declaration.columns;
    const builtin = findColumnsOwner(context, key);
    if (builtin === undefined) {
      if (declaration.declares === "Extension") builder.resolve(declaration.path, source);
      continue;
    }
    if (source.origin === "Engine") builtin.origin = "Engine";
    if (declaration.declares !== "Member" || source.proof !== "Structure") {
      addColumns(builder, builtin, columns, source);
      continue;
    }
    const { platforms = targetPlatforms, ...others } = columns;
    structurePlatforms.set(builtin, new Set([...(structurePlatforms.get(builtin) ?? []), ...platforms]));
    addColumns(builder, builtin, others, source);
  }
}

function createAnswerOf(made: ModelBuiltin): SignatureDeclaration {
  return {
    mode: "Get",
    receiver: null,
    parameters: [],
    result: { type: "Builtin", path: joinPath(made.path) },
    capability: "heap",
    throws: true,
    isUndeclared: false,
  };
}

// The entry of the binding goes on speaking for the function, for those who come by the function without the compiler.
function describeFunctionsOfBindings({ builder }: EntryContext): void {
  for (const [made, binding] of builder.bindingsOfFunctions) {
    const written = builder.writtenEntryOf(binding);
    const answer = written.signatures.find(({ signature }) => signature.mode === "Get" || signature.mode === "Set");
    if (answer !== undefined) {
      builder.problems.add(answer.source, `${binding.text} makes a function, so nobody writes what it answers`);
      continue;
    }
    Object.assign(builder.writtenEntryOf(made), {
      columns: [...builder.writtenEntryOf(made).columns, ...written.columns],
      signatures: [...written.signatures],
      length: written.length,
    });
    written.signatures.push({ signature: createAnswerOf(made), source: written.source });
  }
}

function extendsClass(builtinClass: ModelClass | undefined, ancestor: ModelClass): boolean {
  let current = builtinClass ?? null;
  while (current !== null && current !== ancestor) current = current.parent;
  return current !== null;
}

// A signature that writes no receiver takes the instances of the class of its prototype, if a test tells them from other values.
function takesOnlyInstances(builder: ModelBuilder, receiver: ParameterType | null, instanceClass: ModelClass): boolean {
  if (instanceClass.instanceTest === "None" || instanceClass.isPrimitiveWrapper) return false;
  if (receiver === null) return true;
  const { accepted, conversion } = receiver;
  return (
    conversion === "None" &&
    accepted.type === "Instance" &&
    extendsClass(builder.findClass(accepted.class), instanceClass)
  );
}

function isReadThroughGetter(implementation: ImplementationSpec | undefined): boolean {
  if (implementation === undefined) return true;
  switch (implementation.how) {
    case "Generic":
    case "HostCall":
      return true;
    case "Compiled":
    case "Inline":
    case "CachedGetter":
    case "OwnSlot":
      return false;
  }
}

function entersCustomGetter(
  builder: ModelBuilder,
  { mode, receiver, isUndeclared, implementation }: SignatureDeclaration,
  instanceClass: ModelClass,
): boolean {
  if (mode !== "Get" || isUndeclared || !isReadThroughGetter(implementation)) return false;
  return takesOnlyInstances(builder, receiver, instanceClass);
}

function entersNativeSetter(
  builder: ModelBuilder,
  { mode, receiver, isUndeclared, implementation }: SignatureDeclaration,
  instanceClass: ModelClass,
): boolean {
  if (mode !== "Set" || isUndeclared || implementation?.how !== "HostCall") return false;
  return takesOnlyInstances(builder, receiver, instanceClass);
}

// The native function behind the getter is known, so a read needs neither a lookup by name nor the function object that a descriptor of the property would have.
function callCustomGetters({ builder }: EntryContext): void {
  for (const builtin of builder.builtins) {
    const symbol = columnOf(builder, builtin, "customGetter");
    const instanceClass = builtin.holder?.kind === "Prototype" ? builtin.holder.instanceClass : null;
    if (symbol === undefined || builtin.kind !== "Accessor" || instanceClass === null) continue;
    const directEntry = columnOf(builder, builtin, "directEntryOfGetter");
    const directEntryOfSetter = columnOf(builder, builtin, "directEntryOfSetter");
    const written = builder.writtenEntryOf(builtin);
    written.signatures = written.signatures.map(({ signature, source }) => {
      if (entersCustomGetter(builder, signature, instanceClass)) {
        return { signature: { ...signature, implementation: customGetterCall(symbol), directEntry }, source };
      }
      if (directEntryOfSetter !== undefined && entersNativeSetter(builder, signature, instanceClass)) {
        return { signature: { ...signature, directEntry: directEntryOfSetter }, source };
      }
      return { signature, source };
    });
  }
}

function entersNativeMethod(
  builder: ModelBuilder,
  { mode, receiver, isUndeclared, implementation, directEntry }: SignatureDeclaration,
  instanceClass: ModelClass,
): boolean {
  if (mode !== "Call" || isUndeclared || directEntry !== undefined) return false;
  if (implementation !== undefined && (implementation.how !== "HostCall" || implementation.customGetter !== undefined))
    return false;
  return takesOnlyInstances(builder, receiver, instanceClass);
}

function enterNativeMethods({ builder }: EntryContext): void {
  for (const builtin of builder.builtins) {
    const directEntry = columnOf(builder, builtin, "directEntryOfMethod");
    const instanceClass = builtin.holder?.kind === "Prototype" ? builtin.holder.instanceClass : null;
    if (directEntry === undefined || builtin.kind !== "Method" || instanceClass === null) continue;
    const written = builder.writtenEntryOf(builtin);
    written.signatures = written.signatures.map(({ signature, source }) =>
      entersNativeMethod(builder, signature, instanceClass)
        ? {
            signature: { ...signature, implementation: signature.implementation ?? { how: "HostCall" }, directEntry },
            source,
          }
        : { signature, source },
    );
  }
}

const unknownPrototype: ModelPrototype = { link: "Unknown" };

function defaultPrototypeOf(builder: ModelBuilder, builtin: ModelBuiltin): ModelPrototype {
  const objectPrototype = builder.find(objectPrototypePath);
  const parent = builtin.instanceClass?.parent ?? null;
  switch (builtin.kind) {
    case "Prototype":
      if (builtin === objectPrototype) return { link: "Null" };
      return linkTo(parent === null ? objectPrototype : parent.prototype);
    case "Constructor":
      return linkTo(parent === null ? builder.find(functionPrototypePath) : parent.constructor);
    case "Function":
    case "Method":
      return linkTo(builder.find(functionPrototypePath));
    case "Namespace":
      return builder.sourceOf(builtin).origin === "Engine" ? linkTo(objectPrototype) : { link: "Unknown" };
    case "Accessor":
    case "DataProperty":
    case "Constant":
    case "NativeBinding":
      return { link: "Unknown" };
  }
}

function linkPrototypes({ builder, sorted }: EntryContext): void {
  const written = new Map<ModelBuiltin, ModelPrototype>();
  for (const { declaration, source } of select(sorted, "Inheritance")) {
    const builtin = builder.resolve(declaration.path, source);
    const prototype = declaration.prototype === null ? null : builder.resolve(declaration.prototype, source);
    if (builtin === null || (prototype === null && declaration.prototype !== null)) continue;
    if (written.has(builtin)) {
      builder.problems.add(source, `the prototype of ${builtin.text} is declared twice`);
      continue;
    }
    written.set(builtin, prototype === null ? { link: "Null" } : linkTo(prototype.sameObjectAs ?? prototype));
  }
  for (const builtin of builder.builtins) {
    const isOfUnknownClass =
      builder.functionsOfUnknownClass.has(builtin) || columnOf(builder, builtin, "hasUndeclaredMembers") === true;
    const byDefault = isOfUnknownClass ? unknownPrototype : defaultPrototypeOf(builder, builtin);
    builtin.prototype = written.get(builtin) ?? byDefault;
  }
  for (const builtin of builder.builtins) {
    if (builtin.sameObjectAs !== null) builtin.prototype = builtin.sameObjectAs.prototype;
  }
}

// The engine and the host create a function with `length` and `name`, which the class Function declares for its instances, and with nothing else but what the table lists under it. aotBuiltinMismatches() compares the own keys of every function that it finds in the realm.
function closeFunctions({ builder }: EntryContext): void {
  for (const builtin of builder.builtins) {
    if (builtin.kind !== "Function" && builtin.kind !== "Method") continue;
    const described = builtin.sameObjectAs ?? builtin;
    if (builder.functionsOfUnknownClass.has(described) || columnOf(builder, described, "hasUndeclaredMembers"))
      continue;
    addFlag(builtin, "ListsAllMembers");
  }
}

function finishEntries(context: EntryContext): void {
  const { builder, structurePlatforms } = context;
  const compilerHelpers = builder.find(compilerHelpersPath);
  for (const builtin of builder.builtins) {
    const { holder } = builtin;
    const structural = structurePlatforms.get(builtin);
    const written = columnOf(builder, builtin, "platforms");
    builtin.platforms = targetPlatforms.filter(
      platform =>
        (structural === undefined || structural.has(platform)) &&
        (written === undefined || written.includes(platform)) &&
        (holder === null || holder.platforms.includes(platform)),
    );
    for (const [column, flag] of flagColumns) {
      if (columnOf(builder, builtin, column) === true) addFlag(builtin, flag);
    }
    if (holder !== null && holder === compilerHelpers) addFlag(builtin, "IsCompilerHelper");
    const writtenColumns = builder.columnsOf(builtin);
    builtin.marks = builtinMarks.filter(mark => writtenColumns.some(({ columns }) => columns.marks?.includes(mark)));
    const loader = writtenColumns.find(({ columns }) => columns.loadsMachineCodeAs !== undefined);
    if (loader !== undefined)
      builtin.loadsMachineCodeAs = builder.resolve(loader.columns.loadsMachineCodeAs!, loader.source);
    builtin.mutability = columnOf(builder, builtin, "mutability") ?? defaultMutabilityOf(builtin);
  }
}

function checkOwnPropertyLists({ builder, ownPropertyLists }: EntryContext): void {
  for (const [holder, { declaration }] of ownPropertyLists) {
    const { isOpen, properties } = declaration;
    for (const { name } of properties.filter(property => property.isCreatedInSomeRuns)) {
      const member = holder.members.find(candidate => candidate.name === builder.internComponent(name));
      if (member === undefined || (!isObjectKind(member.kind) && member.mutability === "ChangesOnItsOwn")) continue;
      builder.problems.add(
        builder.sourceOf(member),
        `${member.text} is created in some runs only, so it is a property or an accessor that changes on its own`,
      );
    }
    if (isOpen) continue;
    const listed = new Set<ModelName>(properties.map(({ name }) => builder.internComponent(name)));
    for (const member of holder.members) {
      if (listed.has(member.name) || member.flags.includes("IsOwnPropertyOfInstances")) continue;
      // The namespace of a module binds `default` to the object, which has no such property.
      if (member.flags.includes("IsDefaultExport")) continue;
      if (member.platforms.every(platform => platformsWithoutOwnPropertyDump.includes(platform))) continue;
      const source = builder.sourceOf(member);
      builder.problems.add(source, `${member.text} is declared and own-properties.txt does not have it`);
    }
  }
}

export function buildEntries(builder: ModelBuilder, declarations: readonly SourcedDeclaration[]): void {
  declareRoots(builder, declarations);
  for (const { declaration, source } of select(declarations, "LeftOut")) {
    if (source.origin !== "Host") builder.problems.add(source, "only a host says what is left out of it");
    else builder.leaveOut(declaration);
  }
  const sorted = sortDeclarations(builder, declarations);
  builder.declarations = sorted;
  const context: EntryContext = {
    builder,
    sorted,
    classesByPath: new Map(),
    ownPropertyLists: new Map(),
    structurePlatforms: new Map(),
  };
  checkGlobalObject(context);
  declareClasses(context);
  createObjects(context);
  registerModules(context);
  createMembers(context);
  resolveKindsOfModuleObjects(context);
  closeModuleNamespaces(builder);
  createOwnProperties(context);
  linkSameObjects(context);
  addWrittenColumns(context);
  describeFunctionsOfBindings(context);
  callCustomGetters(context);
  enterNativeMethods(context);
  closeFunctions(context);
  linkPrototypes(context);
  finishEntries(context);
  checkOwnPropertyLists(context);
  for (const { declaration, source } of select(sorted, "Name")) {
    const name = builder.internComponent(declaration.text);
    if (source.origin === "Engine") builder.namesDeclaredByEngine.add(name);
  }
  for (const { declaration, source } of select(sorted, "HostRole")) {
    if (source.origin !== "Engine")
      builder.problems.add(source, `${declaration.path}: only the engine declares a role of the host`);
    else builder.hostRoles.push({ path: declaration.path, source });
  }
  for (const { declaration, source } of select(sorted, "HostClassRole")) {
    if (source.origin !== "Engine")
      builder.problems.add(source, `${declaration.name}: only the engine declares a role of the host`);
    else builder.hostClassRoles.push({ name: declaration.name, source });
  }
  for (const { declaration, source } of select(sorted, "UnfilledHostRoles")) {
    if (source.origin !== "Host")
      builder.problems.add(source, "only a host says where the roles point that it leaves out");
    else if (builder.unfilledHostRoles !== null) builder.problems.add(source, "unfilledHostRoles() is written twice");
    else builder.unfilledHostRoles = { path: declaration.path, class: declaration.class, source };
  }
}

const hasSameNames = (left: readonly ModelName[], right: readonly ModelName[]): boolean =>
  left.length === right.length && left.every((name, index) => name === right[index]);

function internRealmStructure(builder: ModelBuilder, getter: string, names: readonly ModelName[]): ModelRealmStructure {
  const known = builder.realmStructures.find(other => other.getter === getter && hasSameNames(other.names, names));
  if (known !== undefined) return known;
  const created: ModelRealmStructure = { id: builder.realmStructures.length, getter, names };
  builder.realmStructures.push(created);
  return created;
}

export function resolveOwnSlot(
  builder: ModelBuilder,
  builtin: ModelBuiltin,
  { structure, after }: OwnSlotSpec,
): ModelImplementation {
  const names = [...after.map(name => builder.internComponent(name)), builtin.name];
  return { how: "OwnSlot", structure: internRealmStructure(builder, structure, names), offset: after.length };
}

interface SlotContext {
  builder: ModelBuilder;
  finished: Set<ModelClass>;
  slotTypes: { slot: MutableSlot; spec: TypeSpec; source: Source }[];
}

function checkHeap(builder: ModelBuilder, builtinClass: ModelClass, heap: Heap, source: Source): void {
  if (builder.schema.heaps.includes(heap)) return;
  builder.problems.add(source, `the class ${builtinClass.token}: the schema declares no heap ${heap}`);
}

function buildParentSlots(
  context: SlotContext,
  builtinClass: MutableClass,
  descendants: ReadonlySet<ModelClass>,
): MutableClass | null {
  const { builder } = context;
  const { declaration, source } = builder.writtenClassOf(builtinClass);
  const parent = declaration.columns.extends === undefined ? undefined : builder.findClass(declaration.columns.extends);
  if (parent === undefined) return null;
  if (parent === builtinClass || descendants.has(parent)) {
    builder.problems.add(source, `the class ${declaration.name} extends itself`);
    builtinClass.parent = null;
    return null;
  }
  buildSlots(context, parent, new Set([...descendants, builtinClass]));
  return parent;
}

function inheritStateHeap(builder: ModelBuilder, builtinClass: MutableClass, parent: ModelClass, source: Source): void {
  const { stateHeap, token } = builtinClass;
  if (parent.stateHeap === null || parent.stateHeap === stateHeap) return;
  if (stateHeap === null) {
    builtinClass.stateHeap = parent.stateHeap;
    return;
  }
  builder.problems.add(
    source,
    `the class ${token} has the state heap ${stateHeap}, and its parent ${parent.token} has ${parent.stateHeap}`,
  );
}

function buildSlots(context: SlotContext, builtinClass: MutableClass, descendants: ReadonlySet<ModelClass>): void {
  const { builder, finished, slotTypes } = context;
  if (finished.has(builtinClass)) return;
  const parent = buildParentSlots(context, builtinClass, descendants);
  finished.add(builtinClass);
  const { declaration, source } = builder.writtenClassOf(builtinClass);
  if (builtinClass.stateHeap !== null) checkHeap(builder, builtinClass, builtinClass.stateHeap, source);
  if (parent !== null) inheritStateHeap(builder, builtinClass, parent, source);
  const slots: ModelSlot[] = [...(parent?.slots ?? [])];
  for (const [name, spec] of Object.entries(declaration.columns.slots ?? {})) {
    const slotName = builder.internName(name, "Text");
    if (slots.some(slot => slot.name === slotName)) {
      builder.problems.add(source, `the class ${declaration.name} and its parents declare the slot ${name} twice`);
      continue;
    }
    if (spec.contentsSlot !== null && slots.some(slot => slot.contentsSlot === spec.contentsSlot)) {
      builder.problems.add(source, `the class ${declaration.name} and its parents have two ${spec.contentsSlot} slots`);
      continue;
    }
    checkHeap(builder, builtinClass, spec.heap, source);
    const slot: MutableSlot = {
      id: -1,
      owner: builtinClass,
      name: slotName,
      indexInClass: slots.length,
      heap: spec.heap,
      contentsSlot: spec.contentsSlot,
      indexInType: spec.contentsSlot === null ? null : slots.filter(other => other.contentsSlot !== null).length,
      holds: null,
    };
    slots.push(slot);
    if (spec.holds !== undefined) slotTypes.push({ slot, spec: spec.holds, source });
  }
  builtinClass.slots = slots;
}

const isConstructorSignature = ({ signature }: WrittenSignature): boolean =>
  signature.mode === "Call" || signature.mode === "Construct";

function copyConstructorSignatures(builder: ModelBuilder): void {
  const copies: { target: WrittenEntry; signatures: WrittenSignature[] }[] = [];
  const abstractConstructors = new Set<WrittenEntry>();
  for (const builtinClass of builder.classes) {
    const { declaration, source } = builder.writtenClassOf(builtinClass);
    const sharedName = declaration.columns.constructorSignaturesOf;
    if (sharedName === undefined) continue;
    const shared = builder.resolveClass(sharedName, source);
    if (shared === null) continue;
    const request = `${declaration.name} takes the constructor signatures of ${sharedName}`;
    if (shared.constructor === null || builtinClass.constructor === null) {
      const withoutConstructor = shared.constructor === null ? sharedName : declaration.name;
      builder.problems.add(source, `${request}, and ${withoutConstructor} has no constructor`);
      continue;
    }
    const target = builder.writtenEntryOf(builtinClass.constructor);
    const own = target.signatures.find(isConstructorSignature);
    if (own !== undefined) {
      builder.problems.add(source, `${request}, and ${own.source.file} declares its own`);
      continue;
    }
    copies.push({ target, signatures: builder.signaturesOf(shared.constructor).filter(isConstructorSignature) });
    abstractConstructors.add(builder.writtenEntryOf(shared.constructor));
  }
  for (const { target, signatures } of copies) target.signatures.push(...signatures);
  // The class that lends its signatures is abstract: constructed itself, it throws whatever it is given.
  for (const { signatures } of abstractConstructors) {
    const own = signatures.map(written => ({
      ...written,
      signature: { ...written.signature, onlyPropagatesErrors: false },
    }));
    signatures.splice(0, signatures.length, ...own);
  }
}

function buildTypeNames(builder: ModelBuilder, builtinClass: ModelClass): ModelTypeName[] {
  const { declaration, source } = builder.writtenClassOf(builtinClass);
  const findSlot = (name: string) => builtinClass.slots.find(slot => slot.name.text === name);
  return (declaration.columns.types ?? []).flatMap(({ path, isView, typeArguments }): ModelTypeName[] => {
    const slots = typeArguments.flatMap(name => findSlot(name) ?? []);
    if (slots.length === typeArguments.length) return [{ path, isView, typeArguments: slots }];
    const unknown = typeArguments.filter(name => findSlot(name) === undefined).join(", ");
    builder.problems.add(source, `the type ${path.join(".")}: the class ${declaration.name} has no slot ${unknown}`);
    return [];
  });
}

function declareLayouts(builder: ModelBuilder, declarations: readonly SourcedDeclaration[]) {
  const layouts = select(declarations, "Layout").sort(
    (left, right) =>
      compareBytes(left.declaration.name, right.declaration.name) || compareSources(left.source, right.source),
  );
  for (const { declaration, source } of layouts) {
    const { name, isTuple } = declaration;
    builder.addLayout(name, { id: -1, token: tokenOf([name]), origin: source.origin, isTuple, fields: [] });
  }
  return layouts;
}

export function buildClasses(
  builder: ModelBuilder,
  declarations: readonly SourcedDeclaration[],
  types: TypeInterner,
): void {
  declareLayouts(builder, declarations);
  const context: SlotContext = { builder, finished: new Set(), slotTypes: [] };
  for (const builtinClass of builder.classes) buildSlots(context, builtinClass, new Set());
  for (const { slot, spec, source } of context.slotTypes) slot.holds = types.intern(spec, null, source);
  for (const builtinClass of builder.classes) {
    const { declaration, source } = builder.writtenClassOf(builtinClass);
    builtinClass.typesOfNamesDefinedOnNewInstances = Object.entries(
      declaration.columns.typesOfNamesDefinedOnNewInstances ?? {},
    ).map(([name, spec]) => ({ name: builder.internComponent(name), type: types.intern(spec, null, source) }));
  }
  copyConstructorSignatures(builder);
  for (const builtinClass of builder.classes) builtinClass.types = buildTypeNames(builder, builtinClass);
}

export function buildLayouts(
  builder: ModelBuilder,
  declarations: readonly SourcedDeclaration[],
  types: TypeInterner,
): void {
  const built = new Set<ModelLayout>();
  for (const { declaration, source } of declareLayouts(builder, declarations)) {
    const layout = builder.resolveLayout(declaration.name, source);
    if (layout === null) continue;
    if (built.has(layout)) {
      builder.problems.add(source, `the layout ${declaration.name} is declared twice`);
      continue;
    }
    built.add(layout);
    const fieldNames = new Set<string>();
    for (const { name, isOptional, type } of declaration.fields) {
      if (name !== null && fieldNames.has(name)) {
        builder.problems.add(source, `the layout ${declaration.name} has the field ${name} twice`);
        continue;
      }
      if (name !== null) fieldNames.add(name);
      layout.fields.push({
        name: name === null ? null : builder.internName(name, "Text"),
        isOptional,
        type: types.intern(type, null, source),
      });
    }
  }
}

export function buildFunctions(builder: ModelBuilder, declarations: readonly SourcedDeclaration[]): void {
  const functions = select(declarations, "RuntimeFunction").sort(
    (left, right) =>
      left.declaration.id - right.declaration.id ||
      compareBytes(keyOfFunction(left.declaration.function), keyOfFunction(right.declaration.function)),
  );
  const functionsById = new Map<number, ModelFunction>();
  for (const { declaration, source } of functions) {
    const { file, name } = declaration.function;
    const runtimeFunction: MutableFunction = {
      id: declaration.id,
      role: declaration.role,
      file,
      name,
      exportName: declaration.exportName,
      cppCodeName: declaration.cppCodeName,
      isHiddenInStackTraces: declaration.isHiddenInStackTraces,
      isNeverInlined: declaration.isNeverInlined,
      usesStubConvention: false,
      platforms: [...declaration.platforms],
      implements: [],
    };
    if (!builder.addFunction(runtimeFunction)) {
      builder.problems.add(source, `${file}: the function ${name} is declared twice`);
      continue;
    }
    const other = functionsById.get(declaration.id);
    if (other !== undefined) {
      builder.problems.add(source, `${file}: ${name} has the id ${declaration.id}, as ${other.name} in ${other.file}`);
      continue;
    }
    functionsById.set(declaration.id, runtimeFunction);
  }
}
