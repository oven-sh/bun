import { GeneratorError } from "./declarations.ts";
import {
  emitArray,
  formatAggregate,
  formatId,
  formatUnlessZero,
  joinBlocks,
  wrapFile,
  type AggregateMember,
} from "./emit-cpp-support.ts";
import { capitalize, fileHeader, sortByBytes } from "./emit-rust-ids.ts";
import {
  noHostNumber,
  type ModelBuiltin,
  type ModelClass,
  type ModelNativeFunction,
  type ModelOverload,
  type TableModel,
} from "./model.ts";
import { compareBytes } from "./paths.ts";
import type { CppClassRef, DirectEntrySpec, FeatureName, Origin } from "./vocabulary.ts";

/** The statement that records an entry of one of the host's tables of functions for whoever links an executable without a feature. The host writes it. */
export type FormatTableEntryRecord = (
  table: string,
  feature: FeatureName,
  stub: "Abort" | "Throw" | "ReturnUndefined" | "ReturnDefault",
  symbol: string,
  builtin?: number,
) => string;

interface BindingLists {
  classes: readonly string[];
  cachedGetters: readonly string[];
  customGetters: readonly string[];
  appendFunctions: readonly string[];
  directFunctions: readonly string[];
  nativeFunctions: readonly string[];
  hostNumbers: readonly string[];
}

interface NativeFunctionEntry {
  builtin: ModelBuiltin;
  nativeFunction: ModelNativeFunction;
}

interface DirectFunctionEntry {
  overload: ModelOverload;
  directEntry: DirectEntrySpec;
}

interface CppSignature {
  result: string;
  parameters: readonly string[];
}

type SwitchCase = readonly [label: string, result: string];

const engineHeaders: readonly string[] = [
  "AOTBuiltinTable.h",
  "AOTBuiltinTableBindings.h",
  "AOTRemovableFeature.h",
  "BuiltinExecutables.h",
  "LinkTimeConstant.h",
];

const checkedExpressionHeaders: readonly string[] = [
  "AbstractModuleRecord.h",
  "IterationKind.h",
  "JSArrayIterator.h",
  "JSAsyncDisposableStack.h",
  "JSAsyncFromSyncIterator.h",
  "JSAsyncGenerator.h",
  "JSDisposableStack.h",
  "JSGenerator.h",
  "JSIteratorHelper.h",
  "JSMapIterator.h",
  "JSPromise.h",
  "JSSetIterator.h",
  "JSStringIterator.h",
  "JSWrapForValidIterator.h",
  "MathCommon.h",
  "Microtask.h",
  "PageCount.h",
  "ProxyObject.h",
  "PureNaN.h",
  "TypedArrayType.h",
];

const standardHeaders: readonly string[] = ["<bit>", "<limits>", "<numbers>", "<type_traits>"];

const codeIndexAssertions = [
  "#define CHECK_CODE_INDEX(codeName, number) static_assert(static_cast<unsigned>(BuiltinCodeIndex::codeName) == number);",
  "FOR_EACH_AOT_ENGINE_BUILTIN_FUNCTION(CHECK_CODE_INDEX)",
  "#undef CHECK_CODE_INDEX",
].join("\n");

const checkedNumberAssertions = [
  "template<typename Expected, typename Actual>",
  "consteval bool isSameNumber(Expected expected, Actual actual)",
  "{",
  "    if constexpr (std::is_floating_point_v<Expected>)",
  "        return std::bit_cast<uint64_t>(expected) == std::bit_cast<uint64_t>(static_cast<double>(actual));",
  "    else",
  "        return expected == static_cast<int64_t>(actual);",
  "}",
  "",
  "#define CHECK_NUMBER(number, expression) static_assert(isSameNumber(number, expression));",
  "FOR_EACH_AOT_CHECKED_NUMBER(CHECK_NUMBER)",
  "#undef CHECK_NUMBER",
].join("\n");

// A symbol of `$newCppFunction` is written for GeneratedJS2Native.h, which looks names up in these.
const namespacesOfHostFunctions = ["Bun", "Bun::Bindgen::Generated", "JSC", "WebCore"]
  .map(namespace => `using namespace ${namespace};`)
  .join("\n");

// The declaration of a thunk spells the types of its parameters with these.
const headersOfDirectFunctions = ["Bindgen/ExternTraits.h", "Bindgen/IDLConvert.h"];

const appendFunctionParameters =
  "(JSC::JSGlobalObject*, JSC::AOT::StringBuilderStorage*, JSC::EncodedJSValue, const JSC::EncodedJSValue*, size_t)";

function inTokenOrder<Item extends { token: string }>(items: readonly Item[]): Item[] {
  return items.toSorted((left, right) => compareBytes(left.token, right.token));
}

function sortUnique(texts: readonly string[]): string[] {
  return sortByBytes([...new Set(texts)]);
}

function cppClassOf(builtinClass: ModelClass): CppClassRef {
  if (builtinClass.instanceCppClass === null) throw new GeneratorError(`class ${builtinClass.token} has no C++ class`);
  return builtinClass.instanceCppClass;
}

function findClassesWithBindings(model: TableModel, origin: Origin): ModelClass[] {
  return model.classes.filter(
    builtinClass =>
      builtinClass.origin === origin &&
      (builtinClass.instanceTest === "ClassInfoInherits" || builtinClass.pristineTest === "InstanceStructure"),
  );
}

function findNativeFunctions(model: TableModel, origin: Origin): NativeFunctionEntry[] {
  return model.builtins.flatMap(builtin => {
    const { nativeFunction } = builtin.attachments;
    return builtin.origin === origin && nativeFunction !== null ? [{ builtin, nativeFunction }] : [];
  });
}

function collectNativeFunctionSymbols(entries: readonly NativeFunctionEntry[]): string[] {
  return sortUnique(entries.map(({ nativeFunction }) => nativeFunction.symbol));
}

function formatRealmLookup(resultType: string, cppExpression: string | null): string | null {
  if (cppExpression === null) return null;
  return `[](JSC::JSGlobalObject* realm) -> ${resultType} { auto* globalObject = defaultGlobalObject(realm); return ${cppExpression}; }`;
}

function formatClassBinding(builtinClass: ModelClass, id: string): string {
  return formatAggregate([
    ["builtinClass", id],
    ["instanceClassInfo", builtinClass.instanceCppClass === null ? null : `${cppClassOf(builtinClass).name}::info()`],
    ["findPrototype", formatRealmLookup("JSC::JSObject*", builtinClass.prototypeCppExpression)],
    ["findInstanceStructure", formatRealmLookup("JSC::Structure*", builtinClass.instanceStructureCppExpression)],
  ]);
}

function formatCachedGetterBinding(overload: ModelOverload): string[] {
  const { implementation } = overload.code;
  if (implementation.how !== "CachedGetter") return [];
  const offset = `OBJECT_OFFSETOF(${implementation.cppClass}, ${implementation.member})`;
  return [
    formatAggregate([
      ["overload", formatId("BuiltinOverloadID", overload)],
      ["offsetOfCachedValue", `static_cast<uint32_t>(${offset})`],
    ]),
  ];
}

function customGetterOf({ code: { implementation } }: ModelOverload): string | null {
  return implementation.how === "HostCall" ? implementation.customGetter : null;
}

function formatCustomGetterBinding(overload: ModelOverload): string[] {
  const symbol = customGetterOf(overload);
  if (symbol === null) return [];
  return [
    formatAggregate([
      ["overload", formatId("BuiltinOverloadID", overload)],
      ["function", symbol],
    ]),
  ];
}

function findFeatureOfHolders(builtin: ModelBuiltin): FeatureName | undefined {
  for (let holder = builtin.holder; holder !== null; holder = holder.holder) {
    const guard = holder.attachments.featureUses.find(use => use.isGuard);
    if (guard !== undefined) return guard.feature;
  }
  return undefined;
}

function formatHostEntryPointRecord(
  table: string,
  builtin: ModelBuiltin,
  symbol: string | null,
  formatRecord: FormatTableEntryRecord,
  stub: "Throw" | "Abort" = "Throw",
): string[] {
  if (symbol === null) return [];
  const guard = builtin.attachments.featureUses.find(use => use.isGuard);
  if (guard !== undefined)
    return [formatRecord(`Bun::AOTHostBindings::${table}`, guard.feature, stub, symbol, builtin.id)];
  const feature = findFeatureOfHolders(builtin);
  return feature === undefined ? [] : [formatRecord(`Bun::AOTHostBindings::${table}`, feature, stub, symbol)];
}

// What stands in for a function of a removed feature throws in the realm that it takes first.
const stubOfDirectFunction = ({ parameters }: DirectEntrySpec) =>
  parameters[0]?.value === "Realm" ? "Throw" : "Abort";

function formatAppendFunctionBinding(builtin: ModelBuiltin): string[] {
  const { hostAppendSymbol } = builtin.attachments;
  if (hostAppendSymbol === null) return [];
  return [
    formatAggregate([
      ["builtin", formatId("BuiltinID", builtin)],
      ["function", `reinterpret_cast<const void*>(${hostAppendSymbol})`],
    ]),
  ];
}

// Nobody calls a native binding. The entry of the function that it makes has the same overloads.
function findDirectFunctions(model: TableModel): DirectFunctionEntry[] {
  return model.overloads.flatMap(overload => {
    const { directEntry } = overload.code;
    return directEntry === null || overload.builtin.kind === "NativeBinding" ? [] : [{ overload, directEntry }];
  });
}

function formatDirectFunctionBinding({ overload, directEntry }: DirectFunctionEntry): string {
  const { symbol, parameters, offsetOfNativeObject = null } = directEntry;
  const values = parameters.map(({ value }) => `BuiltinDirectValue::${value}`);
  return formatAggregate([
    ["overload", formatId("BuiltinOverloadID", overload)],
    ["function", `reinterpret_cast<const void*>(${symbol})`],
    ["parameters", values.length === 0 ? null : `{ ${values.join(", ")} }`],
    ["parameterCount", formatUnlessZero(values.length)],
    ["offsetOfNativeObject", offsetOfNativeObject],
  ]);
}

function formatNativeFunctionBinding(id: string, pointer: string, { length }: ModelNativeFunction): string {
  return formatAggregate([
    ["builtin", id],
    ["function", pointer],
    ["length", formatUnlessZero(length)],
  ]);
}

function formatLinkTimeConstantBinding(builtin: ModelBuiltin): string[] {
  const { linkTimeConstant } = builtin.attachments;
  if (linkTimeConstant === null) return [];
  return [
    formatAggregate([
      ["builtin", `Builtins::${builtin.token}`],
      ["constant", `LinkTimeConstant::${linkTimeConstant}`],
    ]),
  ];
}

function emitBindings(declaration: string, lists: BindingLists): string {
  const arrays = [
    ["classes", "static constexpr BuiltinClassBinding", lists.classes],
    ["cachedGetters", "static constexpr BuiltinCachedGetterBinding", lists.cachedGetters],
    ["customGetters", "static constexpr BuiltinCustomGetterBinding", lists.customGetters],
    ["appendFunctions", "static const BuiltinAppendFunctionBinding", lists.appendFunctions],
    ["directFunctions", "static const BuiltinDirectFunctionBinding", lists.directFunctions],
    ["nativeFunctions", "static constexpr BuiltinNativeFunctionBinding", lists.nativeFunctions],
    ["hostNumbers", "static constexpr BuiltinHostNumberBinding", lists.hostNumbers],
  ] as const;
  const bindingSet = formatAggregate(
    arrays.map(([name, , elements]): AggregateMember => [name, elements.length === 0 ? null : name]),
  );
  return joinBlocks([
    ...arrays.map(([name, qualifiedType, elements]) => emitArray(`${qualifiedType} ${name}`, elements)),
    `${declaration} = ${bindingSet};`,
  ]);
}

function emitSwitchFunction(signature: string, subject: string, cases: readonly SwitchCase[]): string {
  return [
    signature,
    "{",
    `    switch (${subject}) {`,
    ...cases.flatMap(([label, result]) => [`    case ${label}:`, `        return ${result};`]),
    "    }",
    "    RELEASE_ASSERT_NOT_REACHED();",
    "}",
  ].join("\n");
}

function emitEngineFunctionDeclarations(entries: readonly NativeFunctionEntry[]): string {
  if (entries.length === 0) return "";
  const declarations = collectNativeFunctionSymbols(entries).map(symbol => `JSC_DECLARE_HOST_FUNCTION(${symbol});`);
  return joinBlocks(["} // namespace AOT", declarations.join("\n"), "namespace AOT {"]);
}

function formatEngineNativeFunction({ builtin, nativeFunction }: NativeFunctionEntry): string {
  const pointer = `JSC_REGISTERED_HOST_FUNCTION(${nativeFunction.symbol})`;
  return formatNativeFunctionBinding(`Builtins::${builtin.token}`, pointer, nativeFunction);
}

function emitEngineBindingLists(
  lists: Readonly<Record<"classes" | "nativeFunctions" | "linkTimeConstants", readonly string[]>>,
): string {
  const arrays = [
    ["classes", "EngineClassBinding", lists.classes],
    ["nativeFunctions", "EngineNativeFunctionBinding", lists.nativeFunctions],
    ["linkTimeConstants", "EngineLinkTimeConstantBinding", lists.linkTimeConstants],
  ] as const;
  const bindingSet = formatAggregate(
    arrays.map(([name, , elements]): AggregateMember => [name, elements.length === 0 ? null : name]),
  );
  return joinBlocks([
    ...arrays.map(([name, cppType, elements]) => emitArray(`static constexpr ${cppType} ${name}`, elements)),
    `constinit const EngineBindingSet engineBuiltinBindings = ${bindingSet};`,
  ]);
}

// Compiled with the engine, so it names an entry by its constant and has none of the table's numbers.
export function emitEngineBindings(model: TableModel): string {
  const classes = findClassesWithBindings(model, "Engine");
  const nativeFunctions = findNativeFunctions(model, "Engine");
  const { checkedJSTypes, linkTimeConstants } = model.syntax;
  const body = joinBlocks([
    emitEngineFunctionDeclarations(nativeFunctions),
    emitEngineBindingLists({
      classes: inTokenOrder(classes).map(builtinClass =>
        formatClassBinding(builtinClass, `BuiltinClasses::${builtinClass.token}`),
      ),
      nativeFunctions: inTokenOrder(nativeFunctions.map(entry => ({ ...entry, token: entry.builtin.token }))).map(
        formatEngineNativeFunction,
      ),
      linkTimeConstants: inTokenOrder(model.builtins).flatMap(formatLinkTimeConstantBinding),
    }),
    emitSwitchFunction(
      "JSType toJSType(CheckedJSType type)",
      "type",
      checkedJSTypes.map((type): SwitchCase => [`CheckedJSType::${type}`, `JSType::${type}`]),
    ),
    emitSwitchFunction(
      "LinkTimeConstant toLinkTimeConstant(LinkTimeConstantID constant)",
      "constant",
      linkTimeConstants.map((constant): SwitchCase => [
        `LinkTimeConstantID::${capitalize(constant)}`,
        `LinkTimeConstant::${constant}`,
      ]),
    ),
    codeIndexAssertions,
    checkedNumberAssertions,
  ]);
  const classHeaders = classes.flatMap(builtinClass => builtinClass.instanceCppClass?.header ?? []);
  const headers = sortUnique([...engineHeaders, ...checkedExpressionHeaders, ...classHeaders]);
  return wrapFile([...headers, ...standardHeaders], body);
}

function emitHostIncludes(
  classes: readonly ModelClass[],
  appendSymbols: readonly string[],
  directFunctions: readonly DirectFunctionEntry[],
  nativeFunctions: readonly NativeFunctionEntry[],
): string {
  const classHeaders = classes.flatMap(builtinClass => builtinClass.instanceCppClass?.header ?? []);
  const functionHeaders = [
    ...(directFunctions.length > 0 ? headersOfDirectFunctions : []),
    ...directFunctions.flatMap(({ directEntry }) => directEntry.headers),
    ...nativeFunctions.flatMap(({ nativeFunction }) => nativeFunction.header ?? []),
  ];
  return [
    "#include <JavaScriptCore/AOTBuiltinTableBindings.h>",
    "#include <JavaScriptCore/StructureInlines.h>",
    ...(appendSymbols.length > 0 ? ["#include <JavaScriptCore/AOTStringBuilderStorage.h>"] : []),
    ...sortUnique(["ZigGlobalObject.h", ...classHeaders, ...functionHeaders]).map(header => `#include "${header}"`),
    "#include <type_traits>",
  ].join("\n");
}

function splitQualifiedName(qualified: string): { namespace: string; name: string } {
  const separator = qualified.lastIndexOf("::");
  if (separator < 0) return { namespace: "", name: qualified };
  return { namespace: qualified.slice(0, separator), name: qualified.slice(separator + "::".length) };
}

function emitHostFunctionDeclarations(qualifiedNames: readonly string[]): string {
  const functions = sortUnique(qualifiedNames).map(splitQualifiedName);
  return joinBlocks(
    Array.from(
      Map.groupBy(functions, ({ namespace }) => namespace),
      ([namespace, members]) => {
        const declarations = members.map(({ name }) => `JSC_DECLARE_HOST_FUNCTION(${name});`).join("\n");
        return namespace === "" ? declarations : `namespace ${namespace} {\n${declarations}\n}`;
      },
    ),
  );
}

function emitExternDeclarations(
  appendSymbols: readonly string[],
  directFunctions: readonly DirectFunctionEntry[],
  nativeFunctionSymbols: readonly string[],
  nativeCallListStamp: string,
): string {
  return [
    ...appendSymbols.map(symbol => `extern "C" bool ${symbol}${appendFunctionParameters};`),
    ...sortUnique(directFunctions.map(({ directEntry }) => directEntry.declaration)),
    ...nativeFunctionSymbols.map(symbol => `extern "C" JSC_DECLARE_HOST_FUNCTION(${symbol});`),
    `extern "C" const uint8_t Bun__js2nativeList_${nativeCallListStamp};`,
  ].join("\n");
}

function emitCallListReference(stamp: string): string {
  return `[[maybe_unused]] __attribute__((used)) static const uint8_t* const nativeCallListStamp = &Bun__js2nativeList_${stamp};`;
}

function emitAppendFormAssertions(appendSymbols: readonly string[]): string {
  return appendSymbols.map(symbol => `static_assert(std::is_same_v<decltype(&${symbol}), HostAppendForm>);`).join("\n");
}

// Compiled code enters these the way it enters an operation of the engine, so they have the calling convention of one.
function emitDirectFormAssertions(directFunctions: readonly DirectFunctionEntry[]): string {
  return sortUnique(
    directFunctions.map(({ directEntry: { symbol, parameters } }) => {
      const types = parameters.map(({ cppType }) => cppType);
      return `static_assert(std::is_same_v<decltype(&${symbol}), JSC::EncodedJSValue (SYSV_ABI*)(${types.join(", ")})>);`;
    }),
  ).join("\n");
}

function formatHostNativeFunction({ builtin, nativeFunction }: NativeFunctionEntry): string {
  return formatNativeFunctionBinding(formatId("BuiltinID", builtin), nativeFunction.symbol, nativeFunction);
}

function formatHostNumberBinding(builtin: ModelBuiltin): string[] {
  if (builtin.hostNumber === noHostNumber) return [];
  return [
    formatAggregate([
      ["builtin", formatId("BuiltinID", builtin)],
      ["number", String(builtin.hostNumber)],
    ]),
  ];
}

export function emitHostBindings(
  model: TableModel,
  formatRecord: FormatTableEntryRecord,
  nativeCallListStamp: string,
): string {
  const classes = findClassesWithBindings(model, "Host");
  const nativeFunctions = findNativeFunctions(model, "Host");
  const appendSymbols = sortUnique(model.builtins.flatMap(builtin => builtin.attachments.hostAppendSymbol ?? []));
  const directFunctions = findDirectFunctions(model);
  const customGetters = sortUnique(model.overloads.flatMap(overload => customGetterOf(overload) ?? []));
  const symbolsWithoutHeader = collectNativeFunctionSymbols(
    nativeFunctions.filter(({ nativeFunction }) => nativeFunction.header === null),
  );
  const isInNamespace = (symbol: string) => symbol.includes("::");
  const records = [
    ...model.builtins.flatMap(builtin =>
      formatHostEntryPointRecord("appendFunctions", builtin, builtin.attachments.hostAppendSymbol, formatRecord),
    ),
    ...new Set(
      directFunctions.flatMap(({ overload, directEntry }) =>
        formatHostEntryPointRecord(
          "directFunctions",
          overload.builtin,
          directEntry.symbol,
          formatRecord,
          stubOfDirectFunction(directEntry),
        ),
      ),
    ),
    ...nativeFunctions.flatMap(({ builtin, nativeFunction }) =>
      formatHostEntryPointRecord("nativeFunctions", builtin, nativeFunction.symbol, formatRecord),
    ),
    ...model.overloads.flatMap(overload => {
      const symbol = customGetterOf(overload);
      return formatHostEntryPointRecord("customGetters", overload.builtin, symbol, formatRecord);
    }),
  ];
  const blocks = [
    `${fileHeader}#include "root.h"`,
    "#if ENABLE(AOT)",
    emitHostIncludes(classes, appendSymbols, directFunctions, nativeFunctions),
    emitExternDeclarations(
      appendSymbols,
      directFunctions,
      symbolsWithoutHeader.filter(symbol => !isInNamespace(symbol)),
      nativeCallListStamp,
    ),
    emitHostFunctionDeclarations(symbolsWithoutHeader.filter(isInNamespace)),
    customGetters.map(symbol => `JSC_DECLARE_CUSTOM_GETTER(${symbol});`).join("\n"),
    "namespace Bun::AOTHostBindings {",
    `using namespace JSC::AOT;\n${namespacesOfHostFunctions}`,
    emitCallListReference(nativeCallListStamp),
    emitAppendFormAssertions(appendSymbols),
    emitDirectFormAssertions(directFunctions),
    emitBindings("static constinit const BuiltinBindingSet hostBindings", {
      classes: classes.map(builtinClass => formatClassBinding(builtinClass, formatId("BuiltinClassID", builtinClass))),
      cachedGetters: model.overloads.flatMap(formatCachedGetterBinding),
      customGetters: model.overloads.flatMap(formatCustomGetterBinding),
      appendFunctions: model.builtins.flatMap(formatAppendFunctionBinding),
      directFunctions: directFunctions.map(formatDirectFunctionBinding),
      nativeFunctions: nativeFunctions.map(formatHostNativeFunction),
      hostNumbers: model.builtins.flatMap(formatHostNumberBinding),
    }),
    "}",
    [
      'extern "C" void Bun__AOT__registerHostBindings()',
      "{",
      ...namespacesOfHostFunctions.split("\n").map(directive => `    ${directive}`),
      ...records.map(record => `    ${record}`),
      "    JSC::AOT::BuiltinBindings::registerHost(Bun::AOTHostBindings::hostBindings);",
      "}",
    ].join("\n"),
    "#else",
    'extern "C" void Bun__AOT__registerHostBindings() { }',
    "#endif",
  ];
  return `${joinBlocks(blocks)}\n`;
}
