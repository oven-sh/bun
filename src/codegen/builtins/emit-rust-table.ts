import { screamingCase } from "../aot-schema/names.ts";
import { GeneratorError } from "./declarations.ts";
import { DependencyClosure, type CallsForTexts, type LoadedModule } from "./dependency-closure.ts";
import {
  emitArray,
  emitCount,
  emitSlice,
  fileHeader,
  formatBuiltinId,
  formatBuiltinName,
  formatByteString,
  formatClass,
  formatModule,
  formatOption,
  formatRuntimeFunction,
  formatString,
  formatStruct,
  formatWellKnownSymbol,
  sortModules,
  sortUniqueNumbers,
} from "./emit-rust-ids.ts";
import {
  builtinFlags,
  type ModelBuiltin,
  type ModelClass,
  type ModelFunction,
  type ModelHostRead,
  type ModelModule,
  type ModelPrototype,
  type ModelStartup,
  type ModelTypeName,
  type NameKind,
  type TableModel,
} from "./model.ts";
import { compareBytes } from "./paths.ts";
import { findRemovableCalls, operandKinds, type OperandDemand, type RemovableCall } from "./removable-calls.ts";
import { targetPlatforms, type ContentsSlot, type TargetPlatform } from "./vocabulary.ts";

const moduleFlags = ["HasSource", "HasOpenNamespace", "ListsAllExports", "IsEsModule", "IsPublic"] as const;
type ModuleFlag = (typeof moduleFlags)[number];

const formatContentsSlot = (slot: ContentsSlot): string => `ContentsSlot::${slot}`;

const formatFunctions = (functions: Iterable<ModelFunction>): string[] =>
  sortUniqueNumbers(Array.from(functions, runtimeFunction => runtimeFunction.id)).map(formatRuntimeFunction);

function formatBits<Word extends string>(rustType: string, words: readonly Word[], set: readonly Word[]): string {
  let bits = 0;
  for (const word of set) {
    const position = words.indexOf(word);
    if (position < 0) throw new GeneratorError(`${rustType} has no bit for ${word}`);
    bits |= 1 << position;
  }
  return `${rustType}::from_bits_retain(0x${bits.toString(16)})`;
}

const formatPlatforms = (platforms: readonly TargetPlatform[]): string =>
  formatBits("Platforms", targetPlatforms, platforms);

function emitBitChecks(rustType: string, constants: readonly string[]): string {
  return constants
    .map((constant, position) => `const _: () = assert!(${rustType}::${constant}.bits() == 1 << ${position});\n`)
    .join("");
}

class StaticListPool {
  readonly #prefix: string;
  readonly #elementType: string;
  readonly #names = new Map<string, string>();
  readonly #definitions: string[] = [];

  constructor(prefix: string, elementType: string) {
    this.#prefix = prefix;
    this.#elementType = elementType;
  }

  add(elements: readonly string[]): string {
    if (elements.length === 0) return "&[]";
    const text = elements.join(", ");
    let name = this.#names.get(text);
    if (name === undefined) {
      name = `${this.#prefix}_${this.#names.size}`;
      this.#names.set(text, name);
      this.#definitions.push(`static ${name}: [${this.#elementType}; ${elements.length}] = [${text}];\n`);
    }
    return `&${name}`;
  }

  emit(): string {
    return this.#definitions.join("");
  }
}

// Few entries load a module or call a function of the library, and many of those share their lists: an entry has the number of its lists.
class DependencyPool {
  readonly #numbers = new Map<string, number>();
  readonly #elements: string[] = [];

  add(loads: string, calls: string, callsForTexts: string, implementedBy: string): number {
    const element = formatStruct("Dependencies", [
      `loads: ${loads}`,
      `calls: ${calls}`,
      `calls_for_texts: ${callsForTexts}`,
      `implemented_by: ${implementedBy}`,
    ]);
    let number = this.#numbers.get(element);
    if (number === undefined) {
      number = this.#elements.length;
      if (number > 0xffff) throw new GeneratorError("there are more lists of dependencies than 16 bits number");
      this.#numbers.set(element, number);
      this.#elements.push(element);
    }
    return number;
  }

  emit(): string {
    return emitArray(`static DEPENDENCIES: [Dependencies; ${this.#elements.length}]`, this.#elements);
  }
}

// The texts one behind the other, and where each starts: four bytes a text where a slice has sixteen.
// In Bun the engine's half of the table holds the same names, and lookup.rs reads them there.
const unlessLinkedWithEngine = '#[cfg(not(feature = "linked_names"))]\n';

function emitTexts(name: string, count: string, texts: readonly string[], attribute: string): string {
  const starts: number[] = [0];
  for (const text of texts) starts.push(starts[starts.length - 1] + Buffer.byteLength(text, "utf8"));
  return [
    `${attribute}static ${name}_BYTES: &[u8] = ${formatByteString(texts.join(""))};\n`,
    attribute + emitArray(`static ${name}_STARTS: [u32; ${count} + 1]`, starts.map(String)),
  ].join("");
}

interface EntryContext {
  closure: DependencyClosure;
  moduleOfNamespace: ReadonlyMap<ModelBuiltin, ModelModule>;
  moduleLoadLists: StaticListPool;
  functionLists: StaticListPool;
  nameLists: StaticListPool;
  callsForTextsLists: StaticListPool;
  dependencies: DependencyPool;
}

function findModulesByNamespace(modules: readonly ModelModule[]): Map<ModelBuiltin, ModelModule> {
  const moduleOfNamespace = new Map<ModelBuiltin, ModelModule>();
  for (const module of modules) {
    if (!moduleOfNamespace.has(module.namespace)) moduleOfNamespace.set(module.namespace, module);
  }
  return moduleOfNamespace;
}

function formatPrototype(prototype: ModelPrototype): string {
  switch (prototype.link) {
    case "Unknown":
    case "Null":
      return `Prototype::${prototype.link}`;
    case "Builtin":
      return `Prototype::Builtin(${formatBuiltinId(prototype.builtin)})`;
  }
}

function firstMemberOf({ members, text }: ModelBuiltin): number {
  if (members.length === 0) return 0;
  const first = members[0].id;
  members.forEach((member, index) => {
    if (member.id !== first + index) throw new GeneratorError(`the members of ${text} are not one run of ids`);
  });
  return first;
}

function formatExportsRead(names: readonly string[] | null): string {
  return names === null ? "None" : `Some(&[${names.map(formatString).sort().join(", ")}])`;
}

function formatModuleLoads(loads: ReadonlyMap<ModelModule, LoadedModule>): string[] {
  return sortModules([...loads.keys()]).map(module => {
    const { isConditional, exportsRead } = loads.get(module)!;
    return formatStruct("ModuleLoad", [
      `module: ${formatModule(module)}`,
      `is_conditional: ${isConditional}`,
      `exports_read: ${formatExportsRead(exportsRead === null ? null : [...exportsRead])}`,
    ]);
  });
}

function formatCallsForTexts(listed: ReadonlyMap<string, CallsForTexts>, context: EntryContext): string[] {
  return [...listed.keys()].sort(compareBytes).map(key => {
    const { argument, texts, calls } = listed.get(key)!;
    return formatStruct("CallsForTexts", [
      `argument: ${argument}`,
      `texts: ${context.nameLists.add(texts.map(text => formatBuiltinName(text.number)))}`,
      `calls: ${context.functionLists.add(formatFunctions(calls))}`,
    ]);
  });
}

function formatEntry(builtin: ModelBuiltin, context: EntryContext): string {
  const { loads, calls, callsForTexts, implementedBy } = context.closure.dependenciesOf(builtin);
  return formatStruct("BuiltinEntry", [
    `kind: BuiltinKind::${builtin.kind}`,
    `origin: Origin::${builtin.origin}`,
    `scope: Scope::${builtin.scope}`,
    `mutability: Mutability::${builtin.mutability}`,
    `platforms: ${formatPlatforms(builtin.platforms)}`,
    `flags: ${formatBits("BuiltinFlags", builtinFlags, builtin.flags)}`,
    `holder: ${formatOption(builtin.holder, formatBuiltinId)}`,
    `name: ${formatBuiltinName(builtin.name.number)}`,
    `prototype: ${formatPrototype(builtin.prototype)}`,
    `class: ${formatOption(builtin.instanceClass, formatClass)}`,
    `module: ${formatOption(context.moduleOfNamespace.get(builtin) ?? null, formatModule)}`,
    `same_object_as: ${formatOption(builtin.sameObjectAs, formatBuiltinId)}`,
    `first_member: ${firstMemberOf(builtin)}`,
    `member_count: ${builtin.members.length}`,
    `dependencies: ${context.dependencies.add(
      context.moduleLoadLists.add(formatModuleLoads(loads)),
      context.functionLists.add(formatFunctions(calls)),
      context.callsForTextsLists.add(formatCallsForTexts(callsForTexts, context)),
      context.functionLists.add(formatFunctions(implementedBy)),
    )}`,
  ]);
}

function emitEntries(model: TableModel): string {
  const context: EntryContext = {
    closure: new DependencyClosure(model),
    moduleOfNamespace: findModulesByNamespace(model.modules),
    moduleLoadLists: new StaticListPool("MODULE_LOAD_LIST", "ModuleLoad"),
    functionLists: new StaticListPool("FUNCTION_LIST", "RuntimeFunction"),
    nameLists: new StaticListPool("NAME_LIST", "BuiltinName"),
    callsForTextsLists: new StaticListPool("CALLS_FOR_TEXTS_LIST", "CallsForTexts"),
    dependencies: new DependencyPool(),
  };
  const entries = model.builtins.map(builtin => formatEntry(builtin, context));
  return [
    "static BUILTINS_IN_ORDER: [BuiltinId; BuiltinId::COUNT as usize] = BuiltinId::ALL;\n",
    context.moduleLoadLists.emit(),
    context.functionLists.emit(),
    context.nameLists.emit(),
    context.callsForTextsLists.emit(),
    context.dependencies.emit(),
    emitArray("static ENTRIES: [BuiltinEntry; BuiltinId::COUNT as usize]", entries),
  ].join("");
}

function emitConstants(model: TableModel): string {
  const countOf = (kind: NameKind): number => model.names.filter(name => name.kind === kind).length;
  return [
    emitCount("TEXT_NAME_COUNT", countOf("Text")),
    emitCount("FIRST_REGISTERED_SYMBOL_NAME", countOf("Text") + countOf("WellKnownSymbol")),
    emitBitChecks(
      "Platforms",
      targetPlatforms.map(platform => platform.toUpperCase()),
    ),
    emitBitChecks("BuiltinFlags", builtinFlags.map(screamingCase)),
    emitBitChecks("ModuleFlags", moduleFlags.map(screamingCase)),
  ].join("");
}

function formatSymbolConstants(builtins: readonly ModelBuiltin[]): string[] {
  return builtins.flatMap(builtin => {
    const { constant } = builtin;
    if (constant === null || constant.constant !== "Symbol") return [];
    const { name } = constant;
    return [`(${formatBuiltinId(builtin)}, ${formatBuiltinName(name.number)}, ${formatWellKnownSymbol(name)})`];
  });
}

function emitNames(model: TableModel): string {
  return [
    emitTexts(
      "NAME_TEXT",
      "TEXT_NAME_COUNT",
      model.names.filter(name => name.kind === "Text").map(name => name.text),
      unlessLinkedWithEngine,
    ),
    emitTexts(
      "SYMBOL_NAME_TEXT",
      "(BuiltinName::COUNT as usize - TEXT_NAME_COUNT)",
      model.names.filter(name => name.kind !== "Text").map(name => name.text),
      "",
    ),
    emitSlice(
      "static SYMBOL_CONSTANTS: &[(BuiltinId, BuiltinName, WellKnownSymbol)]",
      formatSymbolConstants(model.builtins),
    ),
  ].join("");
}

function formatTypeName({ path, isView, typeArguments }: ModelTypeName): string {
  const contentsSlots = typeArguments.map(slot => formatOption(slot.contentsSlot, formatContentsSlot));
  return formatStruct("TypeName", [
    `path: &[${path.map(component => formatString(component)).join(", ")}]`,
    `is_view: ${isView}`,
    `type_arguments: &[${contentsSlots.join(", ")}]`,
  ]);
}

function formatClassContents(builtinClass: ModelClass): string[] {
  return builtinClass.slots
    .flatMap(({ contentsSlot, indexInType }) =>
      contentsSlot === null || indexInType === null ? [] : [{ contentsSlot, indexInType }],
    )
    .sort((left, right) => left.indexInType - right.indexInType)
    .map(({ contentsSlot }) => formatContentsSlot(contentsSlot));
}

function formatClassData(builtinClass: ModelClass): string {
  return formatStruct("ClassData", [
    `parent: ${formatOption(builtinClass.parent, formatClass)}`,
    `constructor: ${formatOption(builtinClass.constructor, formatBuiltinId)}`,
    `prototype: ${formatOption(builtinClass.prototype, formatBuiltinId)}`,
    `has_instance_test: ${builtinClass.instanceTest !== "None"}`,
    `contents: &[${formatClassContents(builtinClass).join(", ")}]`,
    `type_names: &[${builtinClass.types.map(formatTypeName).join(", ")}]`,
  ]);
}

function flagsOfModule(module: ModelModule): ModuleFlag[] {
  const isSet: Record<ModuleFlag, boolean> = {
    HasSource: module.hasSource,
    HasOpenNamespace: module.hasOpenNamespace,
    ListsAllExports: module.listsAllExports,
    IsEsModule: module.isEsModule,
    IsPublic: module.isPublic,
  };
  return moduleFlags.filter(flag => isSet[flag]);
}

function formatModuleData(module: ModelModule): string {
  return formatStruct("ModuleData", [
    `namespace: ${formatBuiltinId(module.namespace)}`,
    `specifier: ${formatString(module.specifier)}`,
    `flags: ${formatBits("ModuleFlags", moduleFlags, flagsOfModule(module))}`,
    `exports_held_by_namespace: &[${module.exportsHeldByNamespace.map(name => formatBuiltinName(name.number)).join(", ")}]`,
  ]);
}

function emitClassesAndModules(model: TableModel): string {
  const modulesBySpecifier = [...model.modules].sort((left, right) => compareBytes(left.specifier, right.specifier));
  return [
    emitArray("static CLASSES: [ClassData; BuiltinClass::COUNT as usize]", model.classes.map(formatClassData)),
    emitArray("static MODULES: [ModuleData; RuntimeModule::COUNT as usize]", model.modules.map(formatModuleData)),
    emitArray(
      "static MODULES_BY_SPECIFIER: [RuntimeModule; RuntimeModule::COUNT as usize]",
      modulesBySpecifier.map(formatModule),
    ),
  ].join("");
}

function formatRuntimeFunctionData({ id, role, file, exportName, platforms }: ModelFunction): string {
  return formatStruct("RuntimeFunctionData", [
    `function: ${formatRuntimeFunction(id)}`,
    `role: RuntimeFunctionRole::${role}`,
    `file: ${formatString(file)}`,
    `export_name: ${formatString(exportName)}`,
    `platforms: ${formatPlatforms(platforms)}`,
  ]);
}

function formatStartupLoad({ module, exports }: ModelStartup["loads"][number]): string {
  return formatStruct("StartupLoad", [
    `module: ${formatModule(module)}`,
    `exports_read: ${formatExportsRead(exports?.map(({ name }) => name.text) ?? null)}`,
  ]);
}

function emitStartup({ modules, loads, functionsCalledWithLoads, moduleLoaderFunctions }: ModelStartup): string {
  return [
    emitSlice("pub static STARTUP_MODULES: &[RuntimeModule]", sortModules(modules).map(formatModule)),
    emitSlice("pub static STARTUP_LOADS: &[StartupLoad]", loads.map(formatStartupLoad)),
    emitSlice("pub static STARTUP_FUNCTIONS: &[RuntimeFunction]", formatFunctions(functionsCalledWithLoads.map(called => called.function))),
    emitSlice("pub static MODULE_LOADER_FUNCTIONS: &[RuntimeFunction]", formatFunctions(moduleLoaderFunctions)),
  ].join("");
}

function formatHostReadUse(use: ModelHostRead["use"]): string {
  switch (use.read) {
    case "Inspected":
    case "Called":
      return `HostReadUse::${use.read}`;
    case "PassedTo":
      return `HostReadUse::PassedTo { builtin: ${formatBuiltinId(use.builtin)}, argument: ${use.argument} }`;
  }
}

function formatHostRead({ context, exportName, use }: ModelHostRead): string {
  return formatStruct("HostRead", [
    `context: HostReadContext::${context}`,
    `export_name: ${formatBuiltinName(exportName.number)}`,
    `read_use: ${formatHostReadUse(use)}`,
  ]);
}

function formatOperandDemand({ primitives, integers, objects }: OperandDemand): string {
  return formatStruct("OperandDemand", [
    `primitives: ${formatBits("OperandKinds", operandKinds, primitives)}`,
    `integers: ${formatOption(integers, ({ minimum, maximum }) => `(${minimum}, ${maximum})`)}`,
    `objects: ObjectDemand::${objects}`,
  ]);
}

function emitRemovableCalls(model: TableModel): string {
  const demandLists = new StaticListPool("OPERAND_DEMAND_LIST", "OperandDemand");
  const position = ({ overload }: RemovableCall) => overload.builtin.id * 256 + overload.indexInBuiltin;
  const calls = findRemovableCalls(model)
    .sort((left, right) => position(left) - position(right))
    .map(({ overload, receiver, parameters, hasRest }) =>
      formatStruct("RemovableCall", [
        `builtin: ${formatBuiltinId(overload.builtin)}`,
        `is_construction: ${overload.mode === "Construct"}`,
        `receiver: ${formatOption(receiver, formatOperandDemand)}`,
        `parameters: ${demandLists.add(parameters.map(formatOperandDemand))}`,
        `has_rest: ${hasRest}`,
      ]),
    );
  return [
    emitBitChecks("OperandKinds", operandKinds.map(screamingCase)),
    demandLists.emit(),
    emitSlice("static REMOVABLE_CALLS: &[RemovableCall]", calls),
  ].join("");
}

export function emitRustTable(model: TableModel): string {
  return [
    fileHeader,
    emitConstants(model),
    emitEntries(model),
    emitNames(model),
    emitClassesAndModules(model),
    emitSlice("static RUNTIME_FUNCTIONS: &[RuntimeFunctionData]", model.functions.map(formatRuntimeFunctionData)),
    emitStartup(model.startup),
    emitSlice(
      "pub static ACCESSOR_FUNCTIONS: &[RuntimeFunction]",
      formatFunctions(model.functions.filter(({ implements: implemented }) => implemented.some(({ kind }) => kind === "Accessor"))),
    ),
    emitSlice("static HOST_READS: &[HostRead]", model.hostReads.map(formatHostRead)),
    emitRemovableCalls(model),
  ].join("");
}
