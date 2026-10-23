import { GeneratorError, Problems } from "./declarations.ts";
import {
  classTokensArray,
  classTokensType,
  hashOfBuiltinTokens,
  nameArraysOf,
  namedListsOf,
  slotTokenOf,
  textNameSlotsArray,
  textNamesArray,
} from "./emit-cpp-names.ts";
import { emitMacroList, formatDouble, formatInt64, joinBlocks } from "./emit-cpp-support.ts";
import { fileHeader } from "./emit-rust-ids.ts";
import type { ModelAttachments, ModelBound, ModelBuiltin, ModelFunction, ModelSlot, TableModel } from "./model.ts";
import { tokenOf } from "./paths.ts";
import { cap } from "./support.ts";

type Constant = readonly [name: string, number: number];
type ArrayDeclaration = readonly [cppType: string, name: string, count: number];

const cppIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const maxUint8EnumeratorCount = 2 ** 8;

function checkIdentifiers(scope: string, identifiers: readonly string[], problems: Problems): void {
  const seen = new Set<string>();
  for (const identifier of identifiers) {
    if (!cppIdentifierPattern.test(identifier))
      problems.add(null, `${scope}::${identifier} is not a valid C++ identifier`);
    if (seen.has(identifier)) problems.add(null, `${scope}::${identifier} is declared twice`);
    seen.add(identifier);
  }
}

function emitCount([name, count]: Constant): string {
  return `inline constexpr unsigned ${name} = ${count};`;
}

function emitConstants(namespace: string, cppType: string, constants: readonly Constant[], problems: Problems): string {
  checkIdentifiers(
    namespace,
    constants.map(([name]) => name),
    problems,
  );
  const lines = constants.map(([name, number]) => `inline constexpr ${cppType} ${name} { ${number} };\n`);
  return `namespace ${namespace} {\n${lines.join("")}}`;
}

function emitEnum(name: string, countName: string, enumerators: readonly string[], problems: Problems): string {
  checkIdentifiers(name, enumerators, problems);
  if (enumerators.length > maxUint8EnumeratorCount)
    problems.add(null, `${name} has ${enumerators.length} enumerators, more than a uint8_t can number`);
  const lines = enumerators.map(enumerator => `    ${enumerator},\n`);
  const body = lines.length === 0 ? "{ }" : `{\n${lines.join("")}}`;
  return `enum class ${name} : uint8_t ${body};\n${emitCount([countName, enumerators.length])}`;
}

function tokenConstantOf({ token, id }: { token: string; id: number }): Constant {
  return [token, id];
}

function slotConstantOf(slot: ModelSlot): Constant {
  return [slotTokenOf(slot), slot.id];
}

function functionConstantOf({ file, name, id }: ModelFunction): Constant {
  return [tokenOf([file.slice(file.lastIndexOf("/") + 1), name]), id];
}

function hasConstant({ role, implements: implemented }: ModelFunction): boolean {
  switch (role) {
    case "CompilerFunction":
    case "Model":
      return true;
    case "EngineBuiltin":
    case "HostBuiltin":
      return implemented.length > 0;
  }
}

function formatEngineFunction({ cppCodeName, id }: ModelFunction): string[] {
  return cppCodeName === null ? [] : [`${cppCodeName}, ${id}`];
}

function formatCheckedNumber({ value, cppExpression }: ModelBound): string[] {
  if (cppExpression === null) return [];
  const isInt64 = Number.isSafeInteger(value) && !Object.is(value, -0);
  return [`${isInt64 ? formatInt64(value) : formatDouble(value)}, (${cppExpression})`];
}

// FNV-1a over the text.
function hashOfText(text: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(text, "utf8")) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash;
}

const stampPattern = /^inline constexpr uint64_t engineListStamp = (0x[0-9a-f]{16})ULL;$/m;

export function engineListStampOf(idsHeader: string): string {
  const stamp = stampPattern.exec(idsHeader)?.[1];
  if (stamp === undefined) throw new GeneratorError("AOTBuiltinIDs.h has no engineListStamp");
  return stamp;
}

// What code that is compiled with the engine takes from the table at compile time. Only the declarations of the engine decide what is in it.
export function emitCppIds(model: TableModel): string {
  const problems = new Problems();
  const { checkedJSTypes, linkTimeConstants } = model.syntax;
  const namedLists = namedListsOf(model);
  const [namedBuiltins, namedNames, namedClasses, namedLayouts] = namedLists.map(({ namespace, cppType, items }) =>
    emitConstants(
      namespace,
      `NamedTableID<${cppType}>`,
      items.map(([constant], position): Constant => [constant, position]),
      problems,
    ),
  );
  const counts: readonly Constant[] = [
    ["numberOfBuiltinSlots", model.slots.length],
    ...namedLists.map(({ countName, items }): Constant => [countName, items.length]),
  ];
  const body = [
    counts.map(emitCount).join("\n"),
    namedBuiltins,
    namedNames,
    namedClasses,
    emitConstants("BuiltinSlots", "BuiltinSlotID", model.slots.map(slotConstantOf), problems),
    namedLayouts,
    emitEnum("CheckedJSType", "numberOfCheckedJSTypes", checkedJSTypes, problems),
    emitEnum("LinkTimeConstantID", "numberOfLinkTimeConstantIDs", linkTimeConstants.map(cap), problems),
    emitEnum("BuiltinBoxedStub", "numberOfBuiltinBoxedStubs", model.boxedStubs, problems),
  ];
  const macros = [
    emitMacroList("FOR_EACH_AOT_ENGINE_BUILTIN_FUNCTION", model.functions.flatMap(formatEngineFunction)),
    emitMacroList("FOR_EACH_AOT_CHECKED_NUMBER", model.checkedNumbers.flatMap(formatCheckedNumber)),
  ];
  problems.throwIfAny();
  const stamp = hashOfText(joinBlocks([...body, ...macros]));
  const blocks = [
    `${fileHeader}#pragma once`,
    "namespace JSC { namespace AOT {",
    `inline constexpr uint64_t engineListStamp = 0x${stamp.toString(16).padStart(16, "0")}ULL;`,
    `#define AOT_NAMESPACE_OF_ENGINE_LIST EngineList_${stamp.toString(16).padStart(16, "0")}`,
    ...body,
    "} }",
    ...macros,
  ];
  return `${joinBlocks(blocks)}\n`;
}

function hasUnseenCodeCondition({ attachments }: ModelBuiltin): boolean {
  return attachments.unseenCodeCondition !== null;
}

function hasForms({ attachments }: ModelBuiltin): boolean {
  const { appendForm, hostAppendSymbol, jsonTextForm, literalPartsForm, bodyBytesForm } = attachments;
  return [appendForm, hostAppendSymbol, jsonTextForm, literalPartsForm, bodyBytesForm].some(form => form !== null);
}

function hasBoxedCallStub({ attachments }: ModelBuiltin): boolean {
  return attachments.boxedCallStub !== null;
}

function isNumberConstant({ constant }: ModelBuiltin): boolean {
  return constant !== null && constant.constant === "Number";
}

function countTexts({ constant }: ModelBuiltin): number {
  return constant !== null && constant.constant === "String" ? constant.texts.length : 0;
}

function isLockedObject({ flags }: ModelBuiltin): boolean {
  return flags.includes("IsLockedObject");
}

export function collectArrayDeclarations(model: TableModel): ArrayDeclaration[] {
  const { builtins, startup } = model;
  const countBuiltins = (isListed: (builtin: ModelBuiltin) => boolean) => builtins.filter(isListed).length;
  const countAttached = (listOf: (attachments: ModelAttachments) => readonly unknown[]) =>
    builtins.reduce((count, { attachments }) => count + listOf(attachments).length, 0);
  return [
    ["Builtin", "builtinTableBuiltins", builtins.length],
    ["BuiltinPackedOverload", "builtinTableOverloads", model.overloads.length],
    ["BuiltinDispatch", "builtinTableDispatches", model.dispatches.length],
    ["BuiltinDispatchNode", "builtinTableDispatchNodes", model.dispatchNodes.length],
    ["BuiltinType", "builtinTableTypes", model.types.length],
    ["BuiltinClass", "builtinTableClasses", model.classes.length],
    ["BuiltinSlot", "builtinTableSlots", model.slots.length],
    ["BuiltinLayout", "builtinTableLayouts", model.layouts.length],
    ...nameArraysOf(model).arrays.map(({ cppType, name, elements }): ArrayDeclaration => [
      cppType,
      name,
      elements.length,
    ]),
    ["BuiltinFeatureUse", "builtinTableFeatureUses", countAttached(attachments => attachments.featureUses)],
    ["BuiltinUnseenCode", "builtinTableUnseenCode", countBuiltins(hasUnseenCodeCondition)],
    ["BuiltinModuleLoad", "builtinTableModuleLoads", countAttached(attachments => attachments.moduleLoads)],
    ["BuiltinModuleLoad", "builtinTableStartupLoads", startup.loads.length],
    ["BuiltinCalledFunction", "builtinTableCalledFunctions", countAttached(attachments => attachments.calledFunctions)],
    ["BuiltinCalledFunction", "builtinTableStartupCalledFunctions", startup.functionsCalledWithLoads.length],
    ["BuiltinHostObject", "builtinTableHostObjects", model.hostObjects.length],
    ["BuiltinNamedMemberCall", "builtinTableNamedMemberCalls", model.namedMemberCalls.length],
    ["BuiltinHostMethodCall", "builtinTableHostMethodCalls", model.hostMethodCalls.length],
    ["BuiltinForms", "builtinTableForms", countBuiltins(hasForms)],
    ["BuiltinBoxedCall", "builtinTableBoxedCalls", countBuiltins(hasBoxedCallStub)],
    ["BuiltinNumberConstant", "builtinTableNumberConstants", countBuiltins(isNumberConstant)],
    [
      "BuiltinStringConstant",
      "builtinTableStringConstants",
      builtins.reduce((count, builtin) => count + countTexts(builtin), 0),
    ],
    ["BuiltinOverloadSummary", "builtinTableOverloadSummaries", model.overloads.length],
    ["RuntimeModuleData", "builtinTableRuntimeModules", model.modules.length],
    ["RuntimeFunctionData", "builtinTableRuntimeFunctions", model.functions.length],
    ["RuntimeModuleID", "builtinTableStartupModules", startup.modules.length],
    ["RuntimeFunctionID", "builtinTableFunctionsCalledWithStartupLoads", startup.functionsCalledWithLoads.length],
    ["BuiltinName", "builtinTableNamesOfHostMethodsCallingStartupLoads", startup.namesOfMethodsCallingLoads.length],
    ["RuntimeFunctionID", "builtinTableModuleLoaderFunctions", startup.moduleLoaderFunctions.length],
    ["BuiltinHostRead", "builtinTableHostReads", model.hostReads.length],
    ["BuiltinID", "builtinTableLockedObjects", countBuiltins(isLockedObject)],
    ["BuiltinMarkedEntry", "builtinTableMarks", builtins.reduce((count, { marks }) => count + marks.length, 0)],
    [
      "BuiltinLoaderOfMachineCode",
      "builtinTableLoadersOfMachineCode",
      countBuiltins(({ loadsMachineCodeAs }) => loadsMachineCodeAs !== null),
    ],
    ["BuiltinClosedKeys", "builtinTableClosedKeys", model.closedKeys.length],
    ["BuiltinNamesReadByNativeCode", "builtinTableNamesReadByNativeCode", model.namesReadByNativeCode.length],
  ];
}

export function emitCppArraysHeader(model: TableModel, engineListStamp: string): string {
  const problems = new Problems();
  const counts: readonly Constant[] = [
    ["numberOfBuiltins", model.builtins.length],
    ["numberOfBuiltinNames", model.names.length],
    ["numberOfBuiltinClasses", model.classes.length],
    ["numberOfBuiltinLayouts", model.layouts.length],
    ["numberOfRuntimeModules", model.modules.length],
    ["numberOfRuntimeFunctions", model.functions.length],
  ];
  const functionConstants = model.functions.filter(hasConstant).map(functionConstantOf);
  const constants = [
    emitConstants("RuntimeModules", "RuntimeModuleID", model.modules.map(tokenConstantOf), problems),
    emitConstants("RuntimeFunctions", "RuntimeFunctionID", functionConstants, problems),
  ];
  problems.throwIfAny();
  const declarations = collectArrayDeclarations(model)
    .filter(([, , count]) => count > 0)
    .flatMap(([cppType, name, count]) => [
      // lookup.rs in src/aot/builtins/table reads the text names where they lie.
      name === textNamesArray
        ? `extern "C" const ${cppType} ${name};`
        : name === classTokensArray
          ? `struct ${classTokensType} : ${cppType} { };`
          : cppType.startsWith("BuiltinTextStorage<")
            ? `extern const ${cppType} ${name};`
            : `extern const ${cppType} ${name}[${count}];`,
      ...(name === textNamesArray ? [`extern const BuiltinNameSlots<${count}> ${textNameSlotsArray};`] : []),
    ]);
  const idLimits = [
    `static_assert(engineListStamp == ${engineListStamp}ULL, "this table was written for another list of the names that the engine's code uses");`,
    "static_assert(numberOfBuiltins <= maxNumberOfBuiltins);",
    "static_assert(numberOfBuiltins <= BuiltinID::hashTableDeletedIndex);",
    "static_assert(numberOfBuiltinNames <= BuiltinName::hashTableDeletedIndex);",
    "static_assert(numberOfBuiltinClasses <= BuiltinClassID::hashTableDeletedIndex);",
    "static_assert(numberOfBuiltinSlots <= BuiltinSlotID::hashTableDeletedIndex);",
    "static_assert(numberOfBuiltinLayouts <= BuiltinLayoutID::hashTableDeletedIndex);",
    "static_assert(numberOfRuntimeModules <= RuntimeModuleID::hashTableDeletedIndex);",
    `static_assert(${model.overloads.length} <= BuiltinOverloadID::hashTableDeletedIndex);`,
    `static_assert(${model.types.length} <= BuiltinTypeID::hashTableDeletedIndex);`,
    `static_assert(${model.dispatchNodes.length} <= BuiltinDispatchNodeID::hashTableDeletedIndex);`,
  ];
  const blocks = [
    `${fileHeader}#pragma once`,
    "#if ENABLE(AOT)",
    '#include "AOTBuiltinNameSlots.h"\n#include "AOTBuiltinTable.h"',
    "namespace JSC { namespace AOT {",
    counts.map(emitCount).join("\n"),
    ...constants,
    declarations.join("\n"),
    `constexpr uint32_t builtinTableHashOfBuiltinTokens = 0x${hashOfBuiltinTokens(model).toString(16)};`,
    idLimits.join("\n"),
    "} }",
    "#endif",
  ];
  return `${joinBlocks(blocks)}\n`;
}
