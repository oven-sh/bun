// Whoever adds an enumerator is shown by the C++ compiler every question that the new one has to answer: aot/ is compiled
// with -Werror=switch, so a switch without `default:` that lacks an enumerator does not compile. A `default:` answers for
// enumerators that nobody has thought of yet. Goes by the text of the engine's sources: a switch whose labels are
// enumerators of an enumeration of the compiler has a `default:` only where the list below says so.
//
// THE NUMBERS BELOW ARE ONLY EVER LOWERED. Opcode and InlineBuiltin have hundreds of enumerators, and a switch over them that
// picks out a few forms keeps its default: there it gives the careful answer (unknown, may, refuse). A yes-or-no question
// about every operation belongs in the schema (aot/ir/schema), where a row that leaves it out is refused.
import { expect, test } from "bun:test";
import { filesOfCompiler, sayWhenSkipped, sources, switchesOf } from "./harness/engine-text";

sayWhenSkipped("test/aot/a-switch-of-the-compiler-names-every-enumerator.test.ts");

// Not the compiler's own: they gain an enumerator only when the engine below is brought up to date.
const enumerationsOfOthers = new Set(["B3", "Air", "MacroAssembler", "ValueRep", "JSRegExpResult"]);

const known: Record<string, string> = {
  "analysis/AOTInductionVariables.cpp": "Opcode 4",
  "analysis/AOTUnspecifiedValuePaths.cpp": "Opcode 2",
  "analysis/AOTVisibleStores.cpp": "Opcode 2",
  "builtins/AOTBuiltinUses.cpp": "Opcode 3",
  "builtins/AOTResolveBuiltins.cpp": "Opcode 1",
  "builtins/AOTSimplifyBuiltinCalls.cpp": "Opcode 1",
  "builtins/AOTSimplifyBuiltinCallsLiterals.cpp": "Opcode 1",
  "builtins/AOTSimplifyBuiltinCallsSplits.cpp": "Opcode 1",
  "codegen/AOTArrivalSiteNumbers.cpp": "Opcode 2",
  "codegen/AOTGuardEmitter.cpp": "Opcode 2",
  "codegen/AOTHintEmitter.cpp": "Opcode 1",
  "codegen/AOTRepresentationEmitter.cpp": "Opcode 1",
  "codegen/AOTStringBuilderCursor.cpp": "Opcode 1",
  "codegen/AOTStringBuiltinEmitter.cpp": "InlineBuiltin 1",
  "image/AOTRegExpRequests.cpp": "Opcode 5",
  "image/AOTStringUses.cpp": "Opcode 1",
  "ir/AOTEdgeResults.cpp": "Opcode 4",
  "ir/AOTEffectsDescription.cpp": "Opcode 1",
  "ir/AOTEffectsOfCalls.cpp": "Opcode 1",
  "ir/AOTInt32Proof.cpp": "Opcode 5",
  "ir/AOTResultRules.cpp": "Opcode 6",
  "ir/AOTResultRulesDeclared.cpp": "Opcode 2",
  "ir/AOTResultRulesNatural.cpp": "Opcode 7",
  "ir/AOTType.cpp": "Primitive 1",
  "ir/AOTVerifierCalls.cpp": "Opcode 4",
  "ir/AOTVerifierOperations.cpp": "Opcode 1",
  "ir/AOTVerifierTypes.cpp": "Opcode 1",
  "passes/AOTAddGenericVersion.cpp": "Opcode 3",
  "passes/AOTCallModules.cpp": "Opcode 1",
  "passes/AOTDeferredClosuresAndConstantCollections.cpp": "Opcode 1",
  "passes/AOTEnvironments.cpp": "Opcode 1",
  "passes/AOTFrameAllocationPointers.cpp": "InlineBuiltin 1, Opcode 5",
  "passes/AOTHeat.cpp": "Opcode 1",
  "passes/AOTModuleVariables.cpp": "Opcode 3",
  "passes/AOTProgramPasses.h": "Opcode 1",
  "passes/AOTResolveCalls.cpp": "Opcode 2",
  "passes/AOTRingPasses.cpp": "InlineBuiltin 1, Opcode 5, Primitive 1",
  "passes/AOTSinkAllocationsCandidates.cpp": "Opcode 1",
  "passes/AOTSinkAllocationsExecution.cpp": "Opcode 2",
  "passes/AOTStringPasses.cpp": "InlineBuiltin 1",
  "passes/AOTVirtualObject.cpp": "Opcode 5",
  "passes/AOTVirtualObjectShapes.cpp": "Opcode 4",
  "place/AOTGlobalBindingPlacement.cpp": "Opcode 1",
  "place/AOTPlacedSites.cpp": "Opcode 4",
  "place/AOTPlacementCheck.cpp": "Opcode 2",
  "place/AOTSiteResolution.cpp": "Opcode 3",
  "place/AOTSlotUses.cpp": "Opcode 1",
  "represent/AOTRepresentationRules.cpp": "Opcode 2",
  "runtime/AOTFrameArrays.h": "Entry 1",
  "runtime/AOTPropertyCachesLeafOperations.cpp": "Kind 1",
  "runtime/AOTRuntimeCounters.h": "RuntimeCounterID 1",
  "runtime/AOTRuntimeTable.h": "Entry 2",
  "select/AOTArithmeticForms.cpp": "Opcode 1",
  "select/AOTArrayRulesInlineForms.cpp": "InlineBuiltin 2",
  "select/AOTBuiltinFormRules.cpp": "InlineBuiltin 6",
  "select/AOTBuiltinFormRulesCollections.cpp": "InlineBuiltin 2",
  "select/AOTBuiltinFormRulesNumbers.cpp": "InlineBuiltin 3",
  "select/AOTComparisonForms.cpp": "Opcode 2",
  "select/AOTKeyPartsRules.cpp": "InlineBuiltin 1",
  "select/AOTPromiseRulesInlineForms.cpp": "InlineBuiltin 1",
  "select/AOTRegExpRules.cpp": "InlineBuiltin 2",
  "select/AOTStringBuilderPartRules.cpp": "Primitive 1",
  "select/AOTStringBuiltinForms.cpp": "InlineBuiltin 1",
  "select/AOTStringCharacterRules.cpp": "Opcode 1",
  "select/AOTStringLiteralRules.cpp": "InlineBuiltin 1",
  "stubs/AOTStubKey.h": "StubFamily 1",
  "valueflow/AOTFlowLiteralOrderResults.cpp": "Opcode 1",
  "valueflow/AOTFlowReportAccesses.cpp": "Opcode 2",
  "valueflow/AOTValueFlowAnalysis.cpp": "Opcode 1",
  "valueflow/AOTValueFlowBodies.cpp": "Opcode 3",
  "valueflow/AOTValueFlowBuiltins.cpp": "BuiltinTypePartKind 1, Opcode 1",
  "valueflow/AOTValueFlowResultsBuiltins.cpp": "Opcode 2",
  "valueflow/AOTValueFlowResultsCalls.cpp": "Opcode 1",
  "valueflow/AOTValueFlowResultsClasses.cpp": "Opcode 2",
  "valueflow/AOTValueFlowResultsContents.cpp": "Opcode 1",
  "valueflow/AOTValueFlowResultsEscape.cpp": "Opcode 3",
  "valueflow/AOTValueFlowResultsFunctions.cpp": "Opcode 1",
  "valueflow/AOTValueFlowResultsHeap.cpp": "Opcode 1",
  "valueflow/AOTValueFlowResultsInternal.h": "Opcode 1",
  "valueflow/AOTValueFlowResultsLocations.cpp": "Opcode 3",
  "valueflow/AOTValueFlowResultsOrder.cpp": "Opcode 1",
  "valueflow/AOTValueFlowResultsPlaces.cpp": "Opcode 4, RemovableFeature 1",
  "valueflow/AOTValueFlowResultsSinks.cpp": "Opcode 1",
  "valueflow/AOTValueFlowResultsStores.cpp": "Opcode 1",
  "valueflow/AOTValueFlowResultsTypes.cpp": "Opcode 3",
  "valueflow/AOTValueFlowResultsUnknown.cpp": "Opcode 1",
  "valueflow/AOTValueFlowResultsUnseenCode.cpp": "Opcode 2",
  "valueflow/AOTValueFlowResultsUses.cpp": "Opcode 1",
  "valueflow/AOTValueFlowResultsVariablesOnObjects.cpp": "Opcode 1",
  "valueflow/AOTValueFlowRules.cpp": "Opcode 2",
  "valueflow/AOTValueFlowRulesArithmetic.cpp": "Opcode 3",
  "valueflow/AOTValueFlowRulesCalls.cpp": "Opcode 1",
  "valueflow/AOTValueFlowRulesHeap.cpp": "Opcode 2",
  "valueflow/AOTValueFlowRulesIteration.cpp": "Opcode 2",
  "valueflow/AOTValueFlowRulesModules.cpp": "Opcode 2",
  "valueflow/AOTValueFlowRulesPromises.cpp": "Opcode 1",
  "valueflow/AOTValueFlowUnobservedDefinitions.cpp": "Opcode 1",
};

test.skipIf(!sources)("a switch over an enumeration of the compiler has a default only where it is known to", () => {
  let numberOfSwitches = 0;
  const tooMany: string[] = [];
  for (const { name, text } of filesOfCompiler()) {
    const allowed = new Map((known[name] ?? "").split(", ").map(entry => entry.split(" ") as [string, string]));
    const found = new Map<string, number[]>();
    for (const { labels, hasDefault, line } of switchesOf(text)) {
      numberOfSwitches++;
      const enumeration = labels
        .find(label => label.includes("::"))
        ?.split("::")
        .at(-2);
      if (!hasDefault || enumeration === undefined || enumerationsOfOthers.has(enumeration)) continue;
      found.set(enumeration, [...(found.get(enumeration) ?? []), line]);
    }
    for (const [enumeration, lines] of found) {
      const limit = Number(allowed.get(enumeration) ?? 0);
      if (lines.length > limit)
        tooMany.push(
          `${name}: ${lines.length} switches over ${enumeration} have a default (lines ${lines.join(", ")}), and ${limit} may`,
        );
    }
  }
  expect(numberOfSwitches).toBeGreaterThan(1000);
  expect(tooMany).toEqual([]);
});
