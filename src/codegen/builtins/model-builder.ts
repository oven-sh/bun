import type { Schema } from "../aot-schema/load.ts";
import {
  Problems,
  type ClassDeclaration,
  type SignatureDeclaration,
  type Source,
  type SourcedDeclaration,
} from "./declarations.ts";
import {
  builtinFlags,
  noHostNumber,
  type BuiltinFlag,
  type ModelAttachments,
  type ModelBound,
  type ModelBuiltin,
  type ModelClass,
  type ModelDispatch,
  type ModelEngineFile,
  type ModelFunction,
  type ModelHostMethodCall,
  type ModelHostObject,
  type ModelHostRead,
  type ModelLayout,
  type ModelModule,
  type ModelName,
  type ModelNamedMemberCall,
  type ModelNamesReadByNativeCode,
  type ModelOverload,
  type ModelPrototype,
  type ModelRealmStructure,
  type ModelSlot,
  type ModelStartup,
  type ModelSyntax,
  type NameKind,
} from "./model.ts";
import {
  cppConstantOfName,
  globalThisPath,
  isHiddenRootComponent,
  joinPath,
  parsePath,
  registeredSymbolPrefix,
  symbolPrefix,
  textOfPath,
  tokenOf,
} from "./paths.ts";
import {
  targetPlatforms,
  type BoxedStubName,
  type BuiltinKind,
  type BuiltinPath,
  type ClassName,
  type EntryColumns,
  type FeatureName,
  type FunctionRef,
  type LayoutName,
  type Mutability,
} from "./vocabulary.ts";

export type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer Item)[] ? Item[] : T[K] };
export type MutableName = Mutable<ModelName>;
export type MutableBuiltin = Mutable<ModelBuiltin>;
export type MutableClass = Mutable<ModelClass>;
export type MutableSlot = Mutable<ModelSlot>;
export type MutableLayout = Mutable<ModelLayout>;
export type MutableModule = Mutable<ModelModule>;
export type MutableFunction = Mutable<ModelFunction>;

export interface WrittenColumns {
  columns: EntryColumns;
  source: Source;
}

export interface WrittenSignature {
  signature: SignatureDeclaration;
  source: Source;
}

export interface WrittenEntry {
  source: Source;
  columns: WrittenColumns[];
  signatures: WrittenSignature[];
  length: number | null;
}

export interface WrittenClass {
  declaration: ClassDeclaration;
  source: Source;
}

export const functionPrototypePath: BuiltinPath = "Function.prototype";

export function isObjectKind(kind: BuiltinKind): boolean {
  switch (kind) {
    case "Namespace":
    case "Constructor":
    case "Function":
    case "Prototype":
    case "Method":
      return true;
    case "Accessor":
    case "DataProperty":
    case "Constant":
    case "NativeBinding":
      return false;
  }
}

export function defaultMutabilityOf(builtin: ModelBuiltin): Mutability {
  const { holder, kind, flags } = builtin;
  if (holder === null) return "AlwaysLocked";
  const locksMembers = holder.flags.includes("IsLockedObject") || holder.flags.includes("HasLockedMembers");
  if (locksMembers && !flags.includes("IsOwnPropertyOfInstances")) return "AlwaysLocked";
  switch (kind) {
    case "Namespace":
    case "Constructor":
    case "Function":
    case "Prototype":
    case "Method":
    case "Constant":
      return "ConstantUnlessWritten";
    case "Accessor":
      return holder.kind === "Prototype" ? "ConstantUnlessWritten" : "ChangesOnItsOwn";
    case "DataProperty":
    case "NativeBinding":
      return "ChangesOnItsOwn";
  }
}

export function addFlag(builtin: MutableBuiltin, added: BuiltinFlag): void {
  builtin.flags = builtinFlags.filter(flag => flag === added || builtin.flags.includes(flag));
}

export function linkTo(prototype: ModelBuiltin | null | undefined): ModelPrototype {
  return prototype == null ? { link: "Unknown" } : { link: "Builtin", builtin: prototype };
}

export const keyOfFunction = ({ file, name }: FunctionRef): string => `${file}\0${name}`;

function createAttachments(): ModelAttachments {
  return {
    featureUses: [],
    unseenCodeCondition: null,
    moduleLoads: [],
    calledFunctions: [],
    appendForm: null,
    hostAppendSymbol: null,
    jsonTextForm: null,
    literalPartsForm: null,
    bodyBytesForm: null,
    boxedCallStub: null,
    nativeFunction: null,
    nativeSymbols: [],
    creationSymbol: null,
    linkTimeConstant: null,
  };
}

class Registry<Item> {
  readonly items: Item[] = [];
  readonly #byKey = new Map<string, Item>();

  find(key: string): Item | undefined {
    return this.#byKey.get(key);
  }

  add(key: string, item: Item): boolean {
    if (this.#byKey.has(key)) return false;
    this.#byKey.set(key, item);
    this.items.push(item);
    return true;
  }
}

export class ModelBuilder {
  readonly problems = new Problems();
  readonly schema: Schema;
  readonly engineFiles: readonly ModelEngineFile[];
  readonly fixedProperties = new Set<ModelBuiltin>();
  /** Objects of modules that are functions by observation alone: nothing says what makes them or what they inherit from. */
  readonly functionsOfUnknownClass = new Set<ModelBuiltin>();
  /** The entry of the function that a native binding makes, and the entry of the binding. */
  readonly bindingsOfFunctions = new Map<ModelBuiltin, ModelBuiltin>();
  readonly openNames = new Map<ModelBuiltin, readonly ModelName[]>();
  readonly namesReadByNativeCode = new Map<ModelBuiltin, Omit<ModelNamesReadByNativeCode, "holder">>();
  readonly realmStructures: ModelRealmStructure[] = [];
  readonly operandsWithoutUses: { builtin: ModelBuiltin; operand: string; source: Source }[] = [];
  readonly #firstStepOfMemberPath = new Map<string, number>();
  #numberOfMemberSteps = 0;
  declarations: readonly SourcedDeclaration[] = [];
  dispatches: ModelDispatch[] = [];
  features: FeatureName[] = [];
  boxedStubs: BoxedStubName[] = [];
  hostReads: ModelHostRead[] = [];
  readonly namesDeclaredByEngine = new Set<ModelName>();
  readonly hostRoles: { path: BuiltinPath; source: Source }[] = [];
  readonly hostClassRoles: { name: ClassName; source: Source }[] = [];
  unfilledHostRoles: { path: BuiltinPath; class: ClassName; source: Source } | null = null;
  hostObjects: ModelHostObject[] = [];
  namedMemberCalls: ModelNamedMemberCall[] = [];
  hostMethodCalls: ModelHostMethodCall[] = [];
  checkedNumbers: ModelBound[] = [];
  startup: ModelStartup = {
    modules: [],
    loads: [],
    functionsCalledWithLoads: [],
    namesOfMethodsCallingLoads: [],
    moduleLoaderFunctions: [],
  };
  syntax: ModelSyntax = {
    intrinsics: [],
    prefixedGlobals: [],
    nativeBindings: [],
    checkedJSTypes: [],
    linkTimeConstants: [],
  };

  readonly #registered = {
    names: new Registry<MutableName>(),
    builtins: new Registry<MutableBuiltin>(),
    classes: new Registry<MutableClass>(),
    layouts: new Registry<MutableLayout>(),
    modules: new Registry<MutableModule>(),
    functions: new Registry<MutableFunction>(),
  };
  readonly #roots = new Map<string, readonly string[]>();
  readonly #writtenEntries = new Map<ModelBuiltin, WrittenEntry>();
  readonly #writtenClasses = new Map<ModelClass, WrittenClass>();
  readonly #signatures = new Map<ModelOverload, SignatureDeclaration>();
  readonly #reported = new Set<string>();

  constructor(input: { schema: Schema; engineFiles: readonly ModelEngineFile[] }) {
    this.schema = input.schema;
    this.engineFiles = input.engineFiles;
  }

  get names(): readonly MutableName[] {
    return this.#registered.names.items;
  }

  get builtins(): readonly MutableBuiltin[] {
    return this.#registered.builtins.items;
  }

  get classes(): readonly MutableClass[] {
    return this.#registered.classes.items;
  }

  get layouts(): readonly MutableLayout[] {
    return this.#registered.layouts.items;
  }

  get modules(): readonly MutableModule[] {
    return this.#registered.modules.items;
  }

  get functions(): readonly MutableFunction[] {
    return this.#registered.functions.items;
  }

  internName(text: string, kind: NameKind): MutableName {
    const key = `${kind} ${text}`;
    const known = this.#registered.names.find(key);
    if (known !== undefined) return known;
    const name: MutableName = { number: -1, text, kind, cppConstant: cppConstantOfName(text, kind) };
    this.#registered.names.add(key, name);
    return name;
  }

  numberMemberPath(path: readonly (string | null)[]): number {
    const key = JSON.stringify(path);
    const known = this.#firstStepOfMemberPath.get(key);
    if (known !== undefined) return known;
    const firstStep = this.#numberOfMemberSteps;
    this.#firstStepOfMemberPath.set(key, firstStep);
    this.#numberOfMemberSteps += path.length;
    return firstStep;
  }

  internComponent(component: string): MutableName {
    if (component.startsWith(registeredSymbolPrefix)) {
      return this.internName(component.slice(registeredSymbolPrefix.length), "RegisteredSymbol");
    }
    if (component.startsWith(symbolPrefix)) {
      return this.internName(component.slice(symbolPrefix.length), "WellKnownSymbol");
    }
    return this.internName(component, "Text");
  }

  declareRoot(root: string, target: BuiltinPath = root): void {
    this.#roots.set(root, this.canonicalPathOf(target));
  }

  canonicalPathOf(path: BuiltinPath): string[] {
    return this.#canonicalize(parsePath(path));
  }

  memberPathOf(holder: BuiltinPath, name: string): string[] {
    return this.#canonicalize([...parsePath(holder), name]);
  }

  #canonicalize(written: readonly string[]): string[] {
    let first = 0;
    while (first < written.length - 1 && written[first] === globalThisPath) first++;
    const [root, ...rest] = written.slice(first);
    return [...(this.#roots.get(root) ?? [root]), ...rest];
  }

  find(path: BuiltinPath): MutableBuiltin | undefined {
    return this.#registered.builtins.find(joinPath(this.canonicalPathOf(path)));
  }

  resolve(path: BuiltinPath, source: Source): MutableBuiltin | null {
    return this.find(path) ?? this.#reportUnknown(source, `${path}: no class, namespace or entry declares it`);
  }

  findClass(name: ClassName): MutableClass | undefined {
    return this.#registered.classes.find(name);
  }

  resolveClass(name: ClassName, source: Source): MutableClass | null {
    return this.findClass(name) ?? this.#reportUnknown(source, `no class is named ${name}`);
  }

  findLayout(name: LayoutName): MutableLayout | undefined {
    return this.#registered.layouts.find(name);
  }

  resolveLayout(name: LayoutName, source: Source): MutableLayout | null {
    return this.findLayout(name) ?? this.#reportUnknown(source, `no layout is named ${name}`);
  }

  resolveFunction(ref: FunctionRef, source: Source): MutableFunction | null {
    return (
      this.#registered.functions.find(keyOfFunction(ref)) ??
      this.#reportUnknown(source, `${ref.file}: no runtime function is named ${ref.name}`)
    );
  }

  resolveModule(specifier: string, source: Source): MutableModule | null {
    return (
      this.#registered.modules.find(specifier) ??
      this.#reportUnknown(source, `no runtime module has the specifier ${specifier}`)
    );
  }

  #reportUnknown(source: Source, message: string): null {
    if (!this.#reported.has(message)) {
      this.#reported.add(message);
      this.problems.add(source, message);
    }
    return null;
  }

  create(path: BuiltinPath, kind: BuiltinKind, source: Source, isRoot = false): MutableBuiltin | null {
    const components = this.canonicalPathOf(path);
    const key = joinPath(components);
    if (this.#registered.builtins.find(key) !== undefined) {
      this.problems.add(source, `${textOfPath(components)} is declared twice`);
      return null;
    }
    let holder: MutableBuiltin | null = null;
    if (!isRoot && !this.#isRoot(components)) {
      holder = this.#resolveHolder(components, source);
      if (holder === null) return null;
    }
    const builtin: MutableBuiltin = {
      id: -1,
      token: tokenOf(components),
      path: components,
      text: textOfPath(components),
      kind,
      origin: source.origin,
      scope: holder?.scope ?? "Realm",
      mutability: "ChangesOnItsOwn",
      platforms: [...(holder?.platforms ?? targetPlatforms)],
      flags: [],
      marks: [],
      loadsMachineCodeAs: null,
      holder,
      name: holder === null ? this.internName(key, "Text") : this.internComponent(components[components.length - 1]),
      prototype: { link: "Unknown" },
      instanceClass: null,
      sameObjectAs: null,
      members: [],
      overloads: [],
      constant: null,
      hostNumber: noHostNumber,
      attachments: createAttachments(),
    };
    builtin.mutability = defaultMutabilityOf(builtin);
    this.#registered.builtins.add(key, builtin);
    this.#writtenEntries.set(builtin, { source, columns: [], signatures: [], length: null });
    holder?.members.push(builtin);
    return builtin;
  }

  #isRoot(components: readonly string[]): boolean {
    const [root] = components;
    return components.length === 1 && (root === globalThisPath || isHiddenRootComponent(root) || this.#roots.has(root));
  }

  #resolveHolder(components: readonly string[], source: Source): MutableBuiltin | null {
    const holder = this.resolve(components.length === 1 ? globalThisPath : joinPath(components.slice(0, -1)), source);
    if (holder === null || isObjectKind(holder.kind)) return holder;
    const text = textOfPath(components);
    this.problems.add(source, `${text}: its holder ${holder.text} is a ${holder.kind}, not an object`);
    return null;
  }

  createHiddenFunction(path: BuiltinPath, owner: ModelBuiltin, source: Source): MutableBuiltin | null {
    const [root] = this.canonicalPathOf(path);
    if (this.find(root) === undefined) this.create(root, "Namespace", source);
    const hidden = this.create(path, "Function", source);
    if (hidden === null) return null;
    hidden.origin = owner.origin;
    hidden.platforms = [...owner.platforms];
    hidden.prototype = linkTo(this.find(functionPrototypePath));
    return hidden;
  }

  addClass(name: ClassName, builtinClass: MutableClass, written: WrittenClass): boolean {
    if (!this.#registered.classes.add(name, builtinClass)) return false;
    this.#writtenClasses.set(builtinClass, written);
    return true;
  }

  addLayout(name: LayoutName, layout: MutableLayout): boolean {
    return this.#registered.layouts.add(name, layout);
  }

  addModule(module: MutableModule): boolean {
    return this.#registered.modules.add(module.specifier, module);
  }

  addFunction(runtimeFunction: MutableFunction): boolean {
    return this.#registered.functions.add(keyOfFunction(runtimeFunction), runtimeFunction);
  }

  writtenEntryOf(builtin: ModelBuiltin): WrittenEntry {
    const written = this.#writtenEntries.get(builtin);
    if (written === undefined) throw new Error(`${builtin.text} was not created by this builder`);
    return written;
  }

  writtenClassOf(builtinClass: ModelClass): WrittenClass {
    const written = this.#writtenClasses.get(builtinClass);
    if (written === undefined) throw new Error(`the class ${builtinClass.token} was not added to this builder`);
    return written;
  }

  sourceOf(builtin: ModelBuiltin): Source {
    return this.writtenEntryOf(builtin).source;
  }

  columnsOf(builtin: ModelBuiltin): readonly WrittenColumns[] {
    return this.writtenEntryOf(builtin).columns;
  }

  signaturesOf(builtin: ModelBuiltin): readonly WrittenSignature[] {
    return this.writtenEntryOf(builtin).signatures;
  }

  lengthOf(builtin: ModelBuiltin): number | null {
    const { length, columns } = this.writtenEntryOf(builtin);
    return length ?? columns.find(written => written.columns.length !== undefined)?.columns.length ?? null;
  }

  recordSignature(overload: ModelOverload, signature: SignatureDeclaration): void {
    this.#signatures.set(overload, signature);
  }

  signatureOf(overload: ModelOverload): SignatureDeclaration | undefined {
    return this.#signatures.get(overload);
  }
}
