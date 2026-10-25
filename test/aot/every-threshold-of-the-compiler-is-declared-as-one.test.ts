// A threshold decides how fast or how large the code is, never what a program prints. Most are so high that only a large program
// meets them, so what lies behind one is code that no small test enters. The rows of aot/ir/schema/limits.def can be made small, all at once,
// by --aot-limit=All:<n>; what AOT_THRESHOLD | AOT_CLASS_THRESHOLD (aot/support/AOTThreshold.h) declares is found by that name.
// Goes by the text of the engine's sources.
//
// THE NUMBERS BELOW ARE ONLY EVER LOWERED, AND NO LINE IS ADDED. They count what is still a plain constant, because an array bound,
// a template argument or a static_assert asks for it. A new threshold is a row of limits.def or an AOT_THRESHOLD.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filesOfCompiler, sayWhenSkipped, sources } from "./harness/engine-text";

sayWhenSkipped("test/aot/every-threshold-of-the-compiler-is-declared-as-one.test.ts");

const plainConstants: Record<string, number> = {
  "analysis/AOTBorrowedParameters.h": 1,
  "analysis/AOTEscapeAnalysis.cpp": 1,
  "analysis/AOTGuardFacts.cpp": 1,
  "analysis/AOTPointsToSolver.cpp": 2,
  "analysis/AOTPropertyAccessPartition.cpp": 1,
  "analysis/AOTValueIdentity.cpp": 1,
  "analysis/AOTVisibleStores.cpp": 1,
  "builtins/AOTBuiltinIDTypes.h": 1,
  "builtins/AOTBuiltinTable.h": 1,
  "builtins/AOTBuiltinTableBindings.h": 1,
  "builtins/AOTMathBuiltinOperations.cpp": 1,
  "builtins/AOTResolveBuiltinsTailCalls.cpp": 1,
  "codegen/AOTArrayBuiltinEmitter.cpp": 1,
  "codegen/AOTB3Policy.cpp": 1,
  "codegen/AOTRuntimeValidationChecks.cpp": 1,
  "codegen/AOTSlotAccessEmitter.cpp": 1,
  "codegen/AOTStringBuilderCursor.cpp": 1,
  "codegen/AOTStringBuilderEmitter.h": 1,
  "image/AOTFaultTable.h": 1,
  "image/AOTImageText.h": 1,
  "image/AOTOutliner.cpp": 2,
  "image/AOTStringUses.cpp": 1,
  "image/AOTWasmModules.cpp": 2,
  "ir/AOTIRLexer.cpp": 1,
  "ir/AOTLayout.h": 1,
  "ir/AOTNameClass.cpp": 1,
  "ir/AOTPrimitives.h": 2,
  "ir/AOTSwitchWindow.h": 1,
  "ir/AOTTypeTable.h": 1,
  "ir/AOTValue.h": 1,
  "object/AOTAssignmentPlans.h": 1,
  "object/AOTCellFormat.h": 2,
  "object/AOTFieldTable.h": 1,
  "object/AOTKeyOrderTable.cpp": 2,
  "object/AOTObjectBuilder.h": 1,
  "object/AOTSlotRepresentation.h": 2,
  "passes/AOTArrayCapacities.cpp": 1,
  "passes/AOTArrayChains.h": 1,
  "passes/AOTArrays.cpp": 1,
  "passes/AOTDecidedBranches.cpp": 1,
  "passes/AOTExpandIteration.cpp": 1,
  "passes/AOTFreshResults.cpp": 1,
  "passes/AOTInlining.cpp": 2,
  "passes/AOTInsertObjectCoercibleChecks.cpp": 1,
  "passes/AOTResolveAccesses.cpp": 1,
  "passes/AOTSinkAllocationsInlining.cpp": 1,
  "passes/AOTTypeTestOperatorRule.cpp": 1,
  "pipeline/AOTDerivedFunctions.cpp": 1,
  "place/AOTPlacement.h": 1,
  "place/AOTShapeTest.h": 2,
  "place/AOTShapeTests.cpp": 1,
  "place/AOTSlotPlanSteps.h": 1,
  "represent/AOTChooseRepresentations.cpp": 1,
  "runtime/AOTArrayAllocationProfile.h": 2,
  "runtime/AOTCallSiteCache.h": 1,
  "runtime/AOTCompactTable.h": 5,
  "runtime/AOTErrorMessages.cpp": 1,
  "runtime/AOTInstance.cpp": 1,
  "runtime/AOTInstanceLayout.h": 1,
  "runtime/AOTInterpreterSlowPaths.h": 1,
  "runtime/AOTJSONScanner.h": 5,
  "runtime/AOTJSONTextWriter.h": 1,
  "runtime/AOTJSONWriteOperations.cpp": 1,
  "runtime/AOTNativeCallExpectation.h": 1,
  "runtime/AOTNativeCallValidation.cpp": 1,
  "runtime/AOTOperandSnapshot.cpp": 3,
  "runtime/AOTOperatorOperations.cpp": 1,
  "runtime/AOTPropertyCaches.cpp": 1,
  "runtime/AOTPropertyCachesFront.h": 1,
  "runtime/AOTPropertyCachesLeafOperations.cpp": 1,
  "runtime/AOTPropertyCachesStringKeys.h": 4,
  "runtime/AOTPropertyCachesWords.h": 3,
  "runtime/AOTRemovableFeature.h": 1,
  "runtime/AOTRuntimeRecords.h": 1,
  "runtime/AOTRuntimeReporter.h": 4,
  "runtime/AOTRuntimeValidation.cpp": 1,
  "runtime/AOTRuntimeValidation.h": 1,
  "runtime/AOTSavedFrame.h": 1,
  "runtime/AOTStackTrace.cpp": 1,
  "runtime/AOTStackTrace.h": 1,
  "runtime/AOTStringBuilderStorage.cpp": 1,
  "runtime/AOTStringBuilderStorage.h": 1,
  "runtime/AOTStringBuilderWords.h": 1,
  "runtime/AOTVMState.h": 1,
  "select/AOTArrayRules.h": 1,
  "select/AOTStoreRunRules.cpp": 2,
  "stubs/AOTConvention.h": 7,
  "stubs/AOTStubCalls.h": 1,
  "stubs/AOTStubKey.h": 2,
  "stubs/AOTStubWords.h": 2,
  "stubs/AOTStubsAllocation.cpp": 2,
  "stubs/AOTStubsAllocation.h": 2,
  "stubs/AOTStubsArithmetic.cpp": 1,
  "stubs/AOTStubsRegExpFrames.h": 1,
  "stubs/AOTStubsStringLiterals.cpp": 1,
  "support/AOTCompileOptionWords.cpp": 1,
  "support/AOTSort.h": 1,
  "valueflow/AOTValueFlowBodies.h": 1,
  "valueflow/AOTValueFlowGraph.h": 2,
  "valueflow/AOTValueFlowRuleContext.cpp": 1,
  "valueflow/AOTValueFlowRulesCalls.cpp": 1,
  "valueflow/AOTValueFlowRulesHeapLookups.cpp": 1,
  "valueflow/AOTValueFlowSolver.cpp": 4,
  "valueflow/AOTValueFlowSolver.h": 2,
  "valueflow/AOTValueSets.h": 1,
};

// A limit that a build can lower has one reader: the build (BuildContext::limit, exceeds, gaveUp) or, at run time, runtimeLimitValue.
// Two that decide by different values no longer agree once it is lowered. What asks for the constant here sizes something for the largest value.
const readersOfTheConstant: Record<string, number> = {
  "analysis/AOTPropertyAccess.h": 1,
  "analysis/AOTPropertyAccessProven.cpp": 1,
  "builtins/AOTBuiltinCalls.cpp": 1,
  "builtins/AOTBuiltinUsesCalls.cpp": 2,
  "codegen/AOTElementEmitterAllocation.cpp": 1,
  "image/AOTRegExpSection.cpp": 1,
  "image/AOTSectionLinker.cpp": 1,
  "image/AOTSectionWriter.cpp": 1,
  "image/AOTWasmModules.cpp": 1,
  "ir/AOTEffectsOfOperands.cpp": 1,
  "place/AOTProgramTableEncoder.h": 1,
  "runtime/AOTRuntimeCounters.cpp": 1,
  "runtime/AOTStringBuilderStorage.h": 2,
  "runtime/AOTStringOperations.cpp": 1,
  "select/AOTArrayRules.h": 3,
  "stubs/AOTStubsPropertyExtraProperties.cpp": 1,
  "stubs/AOTStubsStrings.cpp": 1,
};

// --aot-limit=All:<n> lowers each limit to no less than its `smallest`. A row whose `smallest` is not 0 is a limit behind which something is not yet right, or the width of a format.
const smallest: Record<string, number> = {
  MaxCaptures: 255,
  MaxLayoutsInType: 3,
  MaxLiteralsInType: 3,
  MaxClassesInType: 3,
  MaxFunctionsInType: 3,
  MaxTypeValuesRounds: 64,
  MaxValueFlowEdgesLogged: 268435456,
  MaxValueFlowSetMembers: 16777216,
  MaxArrayLiteralBatch: 16,
  MaxArgumentRegisters: 8,
  MaxBuiltinCallArguments: 254,
  MaxSelectionGroupMembers: 1,
  FieldsInKeyOrder: 4095,
  KeyOrdersPerLayout: 4096,
  InlineFramesPerFunction: 16777215,
  DirectCallReach: 2097152,
  RegExpSectionSize: 4294967295,
  MaxCachedKeyLength: 2,
};

// The front end's. In place of a new one: a row of limits.def, which LimitValues hands to every stage.
const plainConstantsOfTheFrontEnd: Record<string, number> = {
  "aot/options.rs": 1,
  "aot/modules/requests.rs": 1,
  "aot/modules/commonjs_exports/text.rs": 1,
  "aot/lower/positions.rs": 1,
  "aot/lower/convert/supertypes.rs": 3,
  "aot/lower/data/values.rs": 1,
  "aot/lower/positions/sites.rs": 1,
  "aot/lower/layouts/object_types.rs": 1,
  "aot/report/causes.rs": 2,
  "aot/report/remaining_checks.rs": 1,
  "aot/report/summary.rs": 1,
  "aot/diagnostics/sink.rs": 2,
  "aot/compile/load_stage.rs": 1,
  "aot/compile/lower_stage.rs": 1,
  "aot/load/module_paths.rs": 1,
  "aot/load/loader_aliases.rs": 1,
  "aot/load/named_loads.rs": 1,
  "aot/known_helpers/resolve.rs": 1,
  "aot/known_helpers/table.rs": 1,
  "aot/known_helpers/find.rs": 1,
  "aot/known_helpers/private_state.rs": 1,
  "aot/ir/ssa.rs": 6,
  "aot/ir/name_class.rs": 2,
  "aot/ir/builder.rs": 3,
  "sema/check/aot/query_writer.rs": 1,
  "sema/check/aot/declared_signatures.rs": 1,
  "sema/check/aot/constructor_function_parents.rs": 3,
  "sema/check/aot/inferred_from_use.rs": 1,
  "sema/check/aot/queries.rs": 2,
  "sema/check/aot/type_shape/recursive_conditionals.rs": 1,
};

const types =
  /^(unsigned|size_t|uint8_t|uint16_t|uint32_t|uint64_t|int|int32_t|int64_t|double|unsigned long|ptrdiff_t)$/;
const declaration =
  /^\s*((?:(?:static|inline|constexpr|const)\s+)+)([\w:]+(?: long)?)\s+(\w+)\s*(?:=\s*([^;{}]+?)|\{\s*([^;{}]+?)\s*\})\s*;/;
const says =
  /(^max|^min|^most|^least|^fewest|^smallest|^largest|^shortest|^longest|Max[A-Z]|Most[A-Z]|Limit|limit|[bB]udget|[tT]hreshold|Depth|depth|[rR]ounds|[sS]teps|[fF]uel|Few|few|Many|many|Small|small|Large|large|Ways|ways|[uU]nroll|[cC]utoff|Window)/;
const saysOtherwise =
  /(Bits?$|Bits[A-Z]|Shift|Mask|Offset|Alignment|Align|[sS]izeIn|[bB]ytesPer|Tag$|Version|[mM]agic|[sS]tride|Index$|Register|GPR|FPR|Printed|Shown|Reported|Listed$|InText$)/;

function grown(found: Map<string, number>, known: Record<string, number>, what: string): string[] {
  return [...found]
    .filter(([file, count]) => count > (known[file] ?? 0))
    .map(([file, count]) => `${file}: ${count} ${what}, and ${known[file] ?? 0} are known`);
}

test.skipIf(!sources)("no threshold is a plain constant that was not one before", () => {
  const found = new Map<string, number>();
  let declared = 0;
  for (const { name, text } of filesOfCompiler())
    for (const line of text.split("\n")) {
      if (/^\s*AOT_(CLASS_)?THRESHOLD\(/.test(line)) declared++;
      const match = declaration.exec(line);
      if (!match) continue;
      const [, specifiers, type, constant, assigned, braced] = match;
      const value = assigned ?? braced;
      if (
        !specifiers.includes("constexpr") ||
        !types.test(type) ||
        !says.test(constant) ||
        saysOtherwise.test(constant) ||
        !/\d/.test(value)
      )
        continue;
      // What follows from another constant, or is one less than a power of two, is the width of a format.
      if (/[A-Za-z_]{3,}|- 1\b|<< 31/.test(value.replace(/\b(KB|MB|GB)\b/g, ""))) continue;
      found.set(name, (found.get(name) ?? 0) + 1);
    }
  expect(declared).toBeGreaterThan(200);
  expect(grown(found, plainConstants, "plain constants that read like a threshold")).toEqual([]);
});

test.skipIf(!sources)("nothing new asks for the constant of a limit in place of the build's value", () => {
  const found = new Map<string, number>();
  for (const { name, text } of filesOfCompiler()) {
    if (name.startsWith("support/AOTLimits.") || name.startsWith("support/AOTCompileOption")) continue;
    const count = text
      .split("\n")
      .filter(line => /\bdefaultLimitValue\(/.test(line) && !/\bstatic_assert\(/.test(line)).length;
    if (count) found.set(name, count);
  }
  expect(grown(found, readersOfTheConstant, "readers of a limit's constant")).toEqual([]);
});

test.skipIf(!sources)("no limit's smallest value has risen", () => {
  const risen: string[] = [];
  for (const [, name, value] of readFileSync(join(sources!, "ir/schema/limits.def"), "utf8").matchAll(
    /^    (\w+)\(\w+, \w+, \w+, \d+, \d+, (\d+), "/gm,
  ))
    if (Number(value) > (smallest[name] ?? 0)) risen.push(`${name}: ${value}, and ${smallest[name] ?? 0} is known`);
  expect(risen).toEqual([]);
});

test("no threshold of the front end is a plain constant that was not one before", () => {
  const found = new Map<string, number>();
  const root = join(import.meta.dir, "..", "..", "src");
  for (const folder of ["aot", "sema/check/aot"])
    for (const file of new Bun.Glob("**/*.rs").scanSync(join(root, folder))) {
      const name = `${folder}/${file.replaceAll("\\", "/")}`;
      if (/(^|\/)(tests|generated)(\/|\.rs$)/.test(name)) continue;
      const count = readFileSync(join(root, name), "utf8").match(
        /^\s*(?:pub(?:\([a-z: ]+\))? )?const (?:MAX|MIN|MOST|FEWEST)_[A-Z0-9_]+: (?:usize|u8|u16|u32|u64|i32|i64) = [0-9_]+(?: << [0-9]+)?;/gm,
      )?.length;
      if (count) found.set(name, count);
    }
  expect(grown(found, plainConstantsOfTheFrontEnd, "plain constants that read like a threshold")).toEqual([]);
});

// What limits.def says of a limit is what happens: past one that degrades the program is slower, and its build is not refused. NO NAME IS ADDED.
const refuseThoughTheyAreSaidToDegrade = ["InlineFramesPerFunction", "KeyOrdersPerLayout", "RegExpSectionSize"];

test.skipIf(!sources)("no limit that is said to degrade refuses a build", () => {
  const degrades = new Set<string>();
  for (const [, name, degradesTo] of readFileSync(join(sources!, "ir/schema/limits.def"), "utf8").matchAll(
    /^    (\w+)\(\w+, \w+, (\w+), /gm,
  ))
    if (degradesTo !== "BuildError") degrades.add(name);
  expect(degrades.size).toBeGreaterThan(150);
  const refusing = new Set<string>();
  for (const { text } of filesOfCompiler())
    for (const [, name] of text.matchAll(/\b(?:reportLimitExceeded|failAtLimit)\(LimitID::(\w+)/g))
      if (degrades.has(name)) refusing.add(name);
  expect([...refusing].filter(name => !refuseThoughTheyAreSaidToDegrade.includes(name))).toEqual([]);
});
