// What an operation or a built-in does is written once: in the schema (aot/ir/schema: effects, what becomes of each operand,
// the columns) and in the table of built-ins. A pass that answers such a question out of a list of its own is right until
// the day somebody adds an operation, and then it answers for the new one without having been asked. Goes by the text of the
// engine's sources: a constant set of operations, and a function that returns bool, that spells three or more enumerators of
// Opcode or InlineBuiltin.
//
// THE NUMBERS BELOW ARE ONLY EVER LOWERED, AND NO LINE IS ADDED but for a list that only guesses, with a line that says what a
// wrong guess costs. In place of a new list: effectsOf(), operandUsesOf(), a column
// of the schema (a new one, where the question is new: the generator refuses a row that must answer and does not), or the
// overloads and behaviors of the table of built-ins.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  closingOf,
  filesOfCompiler,
  sayWhenSkipped,
  sources,
  switchesOf,
  withoutCommentsAndLiterals,
} from "./harness/engine-text";

sayWhenSkipped("test/aot/lists-of-operations-in-the-compiler-only-shrink.test.ts");

const known: Record<string, number> = {
  "analysis/AOTGuardFacts.cpp fillsSlotWithDeclaredType": 3,
  "analysis/AOTInductionVariables.cpp isBoundingRelation": 4,
  "analysis/AOTInductionVariables.h relationalOperators": 4,
  "analysis/AOTIntegerRelations.cpp wholeBinaryOperators": 3,
  "analysis/AOTPropertyAccessElements.cpp elementOperations": 10,
  "analysis/AOTValueIdentity.cpp isBorrowedInnerObject": 3,
  "analysis/AOTValueIdentity.cpp operationsOnCell": 8,
  "analysis/AOTValueIdentity.h handsOnBorrowedInnerObject": 5,
  "analysis/AOTValueIdentity.h others": 5,
  "builtins/AOTBuiltinMembers.cpp callsByValue": 4,
  "builtins/AOTBuiltinUses.cpp mayFindProvenPlan": 4,
  "builtins/AOTBuiltinUses.h builtinUseOpcodes": 7,
  "builtins/AOTResolveBuiltins.cpp resolvedCallsByValue": 3,
  "builtins/AOTResolveBuiltinsInternal.h callsWithList": 3,
  "builtins/AOTSimplifyBuiltinCallsInternal.h constantListCallOpcodes": 3,
  "builtins/AOTSimplifyBuiltinCallsInternal.h constantListSourceOpcodes": 3,
  "builtins/AOTSimplifyBuiltinCallsInternal.h simplifiedIntrinsics": 9,
  "builtins/AOTSimplifyBuiltinCallsSplits.cpp readsLengthOf": 3,
  "builtins/AOTSimplifyBuiltinCallsURLs.cpp collectUsesOfSearchParams": 5,
  "codegen/AOTArrivalSiteNumbers.cpp opcodeCallsByValue": 4,
  "codegen/AOTHintEmitter.cpp isLengthOfDataWhereComputed": 5,
  "codegen/AOTHintEmitter.cpp readsLengthOfData": 3,
  "codegen/AOTSlotAccessEmitter.cpp storesBySlot": 3,
  "codegen/AOTStringBuilderCursor.h renewsReservation": 3,
  "codegen/AOTStringBuilderEmitter.cpp stackBuilderOperations": 11,
  "image/AOTRegExpRequests.cpp addArgumentsGivenToClosures": 3,
  "image/AOTRegExpRequests.cpp isCall": 3,
  "image/AOTRegExpRequests.cpp isRuledOut": 5,
  "image/AOTStringUses.cpp hasStringsForMessagesOnly": 6,
  "image/AOTStringUses.cpp keyOrComparisonOpcodes": 13,
  "ir/AOTEffectSummaries.cpp describeByRole": 9,
  "ir/AOTEffectsDeclared.h opcodesThrowingOnlyForLackOfMemory": 23,
  "ir/AOTEffectsDescription.cpp isRefinedByValue": 6,
  "ir/AOTEffectsDescription.cpp validatesNothing": 3,
  "ir/AOTEffectsOfCalls.cpp callsThatCopyArgumentsOfAnyNumber": 5,
  "ir/AOTResultRuleMonotonicity.cpp opcodesThatKeepCodeBehindFailedCheck": 3,
  "ir/AOTResultRules.cpp opcodesWhoseRuleReadsTheLevel": 6,
  "ir/AOTResultRulesNatural.cpp fractionFreeOperators": 9,
  "ir/AOTVerifierCalls.cpp isLegalInitializerThis": 5,
  "ir/AOTVerifierOperations.cpp opcodesWithClassRules": 3,
  "ir/AOTVerifierOperations.cpp opcodesWithConstructionRules": 4,
  "ir/AOTVerifierOperations.cpp tailCallOpcodes": 4,
  "passes/AOTAddGenericVersion.cpp appendResultsTestedBy": 3,
  "passes/AOTAddGenericVersion.cpp isTypedWithoutOperands": 5,
  "passes/AOTAddGenericVersion.cpp tryCreateGenericVersion": 4,
  "passes/AOTArrayCapacities.cpp readsNamingArrayStorage": 3,
  "passes/AOTArrays.cpp asksWhetherValueIsAbsent": 3,
  "passes/AOTArrays.cpp localArrayAllocations": 6,
  "passes/AOTArrays.cpp operatorsOnNumericOperands": 23,
  "passes/AOTArrays.cpp resolvedAccessesWithPresenceTest": 4,
  "passes/AOTCallModules.cpp isMarkOfRequireSpelled": 10,
  "passes/AOTCallModules.cpp opcodesOfSites": 5,
  "passes/AOTCallModules.cpp opcodesThatSpellKeys": 10,
  "passes/AOTDeferredClosuresAndConstantCollections.cpp constantNodeOpcodes": 7,
  "passes/AOTDeferredClosuresAndConstantCollections.cpp opcodesOfSites": 3,
  "passes/AOTEnvironments.cpp holdsAmongSeveralResults": 3,
  "passes/AOTEnvironments.cpp isRewrittenUse": 4,
  "passes/AOTExpandOwnKeysInternal.h opcodesOfWalks": 3,
  "passes/AOTFinishBirths.cpp operationsThatKeepObjectPrivate": 14,
  "passes/AOTFrameAllocationPlanner.cpp FramePlanner::isOnlyCalled": 4,
  "passes/AOTFrameAllocationPlanner.cpp isValueOfDeferringField": 3,
  "passes/AOTFrameAllocationPointers.cpp readersOfArraysWhereTheyLie": 20,
  "passes/AOTFrameAllocationPointers.cpp readsArrayWhereItLies": 3,
  "passes/AOTFrameAllocationPointers.h readsFollowedByFramePointers": 4,
  "passes/AOTFrameAllocationPointers.h storesFollowedByFramePointers": 4,
  "passes/AOTFreshResults.cpp storesIntoNamedFields": 4,
  "passes/AOTHeat.cpp callsOfOneStub": 8,
  "passes/AOTHeat.cpp isOneCallOfStub": 8,
  "passes/AOTInlining.cpp opcodesWithoutCode": 22,
  "passes/AOTInt32Conversions.h int32ConvertingOperations": 9,
  "passes/AOTJSONVerification.cpp cursorInvalidatingOpcodes": 3,
  "passes/AOTKnownValue.h opcodesCreatingKnownStrings": 3,
  "passes/AOTModuleVariables.cpp definitionByDescriptorMayMove": 5,
  "passes/AOTModuleVariables.cpp isMadeGiven": 5,
  "passes/AOTModuleVariables.cpp isOnlyFilledHere": 15,
  "passes/AOTModuleVariables.cpp mayMove": 13,
  "passes/AOTModuleVariables.cpp storeMayMove": 4,
  "passes/AOTProgramPasses.h callSiteOpcodes": 12,
  "passes/AOTProgramPasses.h hoistableReadOpcodes": 3,
  "passes/AOTProgramPasses.h objectCoercibleCheckOpcodes": 6,
  "passes/AOTProgramPasses.h operatorsOnInt32": 6,
  "passes/AOTResolveAccesses.cpp isReadOfUntypedFieldInColdCode": 3,
  "passes/AOTResolveAccesses.cpp listFirstStoresAtAllocation": 4,
  "passes/AOTResolveCalls.cpp findSpreadOfRest": 6,
  "passes/AOTResolveCalls.cpp isSeenByNobodyElse": 6,
  "passes/AOTResolveCalls.cpp mayHavePlan": 3,
  "passes/AOTRingPasses.cpp evaluateRelation": 4,
  "passes/AOTRingPasses.cpp foldOnce": 16,
  "passes/AOTRingPasses.cpp primitiveConstantOpcodes": 6,
  "passes/AOTSimplifyCasts.cpp repeatableCasts": 4,
  "passes/AOTSinkAllocationsCandidates.cpp AllocationPrefilter::neverFolds": 3,
  "passes/AOTSinkAllocationsCandidates.cpp AllocationSinking::collectCandidates": 7,
  "passes/AOTSinkAllocationsCandidates.cpp operationsOnSlots": 7,
  "passes/AOTSinkAllocationsCandidates.cpp testsIndependentOfStores": 7,
  "passes/AOTStringPasses.cpp operationsHandingOnValues": 7,
  "passes/AOTTypeTestOperatorRule.cpp operationsOnElements": 3,
  "passes/AOTTypeTestOperatorRule.cpp operationsOnElementsOfViews": 3,
  // Only guesses: whether the test in front of the operator lets undefined and null pass. A wrong guess costs a test that fails, or a form that reckons with more than arrives.
  "passes/AOTTypeTestOperatorRule.cpp operatorsThatTakeNullish": 3,
  "passes/AOTTypeTestOperatorRule.cpp testedBitwiseOperators": 7,
  "passes/AOTVirtualObjectParameters.cpp objectTests": 6,
  "passes/AOTVirtualObjectShapes.cpp isSubjectOperand": 22,
  "passes/AOTVirtualObjectShapes.h evaluatedTests": 22,
  "passes/AOTVirtualObjectShapes.h testsLeftToRun": 5,
  "place/AOTPlacedSites.cpp SiteScanner::isWeightRead": 3,
  "place/AOTPlacedSites.cpp opcodesNamingKeyCell": 6,
  "place/AOTPlacementCheck.cpp isAllocationOf": 3,
  "place/AOTPlacementCheck.cpp isRequestOf": 8,
  "place/AOTPropertyRuns.cpp namesPropertyRun": 3,
  "place/AOTSlotPlan.cpp canUseEncodedValue": 3,
  "place/AOTSlotPlan.cpp constantsComparedBitwise": 3,
  "place/AOTSlotPlan.h operationsWithOffsetByShape": 5,
  "place/AOTSlotUses.cpp allocationOpcodes": 3,
  "place/AOTSlotUses.cpp collectFreshObjects": 4,
  "represent/AOTRepresentationRules.cpp binaryOperatorsOnInt32": 5,
  "represent/AOTRepresentationRules.cpp isTestOfNumber": 4,
  "represent/AOTRepresentationRules.cpp operationsIndexedByNumber": 12,
  "represent/AOTRepresentationRules.cpp representedBitwiseOperators": 7,
  "represent/AOTRepresentationRules.cpp testOperators": 7,
  "represent/AOTRepresentationRules.cpp testsOfCellOrBoxedValue": 4,
  "represent/AOTRepresentationRules.h constantsInFormOfUses": 8,
  "represent/AOTRepresentationRules.h sumsOfNumbers": 4,
  "select/AOTNumberPathRules.cpp hasTaggedResult": 3,
  "select/AOTNumberPathRules.cpp pathOperators": 20,
  "select/AOTOperatorForms.cpp bigIntBitwiseOperators": 6,
  "select/AOTOperatorForms.cpp integerArithmeticOperators": 7,
  "select/AOTStringCharacterRules.cpp readersThatOnlyCutPieces": 3,
  "valueflow/AOTFlowLiteralOrderResults.cpp literalPieceOperations": 5,
  "valueflow/AOTFlowReportAccesses.cpp constants": 8,
  "valueflow/AOTValueFlowBodies.cpp isObjectUnderConstruction": 4,
  "valueflow/AOTValueFlowResultsClasses.cpp ClosuresTakenOutOfMembers::leavesClosuresInPlace": 3,
  "valueflow/AOTValueFlowResultsEscape.cpp readsArgumentsOfFrame": 5,
  "valueflow/AOTValueFlowResultsTypes.cpp NumbersOfPositions::typeWritersByRules": 3,
  "valueflow/AOTValueFlowResultsUnseenCode.cpp opcodeCallsValue": 6,
  "valueflow/AOTValueFlowRules.h passesList": 3,
  "valueflow/AOTValueFlowRulesArithmetic.cpp answersInt32": 6,
  "valueflow/AOTValueFlowRulesArithmetic.cpp makesNoFraction": 8,
  "valueflow/AOTValueFlowRulesHeapLookups.cpp HeapRule::namesObjectOfAccess": 3,
  "valueflow/AOTValueFlowUnobservedDefinitions.cpp returnsOnlyConstructedObject": 4,
};

// TODO: each of these spells one name more than its number: Opcode::HasInPrototypeChain (foldOnce), Opcode::PropDelete (neverFolds),
// Opcode::FindSourcePlan (isRequestOf), Opcode::LoopHint (opcodesThrowingOnlyForLackOfMemory). They grew while this test read the text of an older engine. The question that each name answers goes into the schema, and its line out of here.
for (const list of [
  "ir/AOTEffectsDeclared.h opcodesThrowingOnlyForLackOfMemory",
  "passes/AOTRingPasses.cpp foldOnce",
  "passes/AOTSinkAllocationsCandidates.cpp AllocationPrefilter::neverFolds",
  "place/AOTPlacementSiteCheck.cpp isRequestOf",
])
  known[list]++;
// TODO: a new list, which came in the same way. What it asks of an operation goes into the schema, and this line out of here.
known["valueflow/AOTValueFlowUnobservedDefinitions.cpp keepsObjectToItself"] = 5;
// TODO: three more new lists, which came in the same way, and go out the same way.
known["passes/AOTCopyClosureFactories.cpp definesWhatStandsAtOnePlace"] = 4;
known["passes/AOTTypeTestOperatorRule.cpp isWantedAsInteger"] = 4;
known["represent/AOTChooseRepresentations.cpp isSumOfWhichOnlyLowBitsAreUsed"] = 5;
// TODO: two more, which only guess: what the back end folds on constants costs no code. A wrong guess moves an estimate of code size. The schema already says natural(Bitwise), natural(Addition).
known["passes/AOTInlining.cpp foldableOpcodes"] = 6;
known["passes/AOTInlining.cpp isConstantExpression"] = 9;
// TODO: two more lists that spell one name more. Opcode::NewFunctionThatThrows (hasStringsForMessagesOnly): its string is read only for
// the message of the error that the function throws. Opcode::TypedArrayRange (opcodesThrowingOnlyForLackOfMemory): it makes a typed array
// over a range of another and throws only where there is no memory for it. Both answers go into the schema, and these lines out of here.
for (const list of [
  "image/AOTStringUses.cpp hasStringsForMessagesOnly",
  "ir/AOTEffectsDeclared.h opcodesThrowingOnlyForLackOfMemory",
])
  known[list]++;

function numberOfNamesIn(body: string): number {
  const names = { Opcode: new Set<string>(), InlineBuiltin: new Set<string>() };
  for (const [, enumeration, name] of body.matchAll(/\b(Opcode|InlineBuiltin)::([A-Z]\w*)/g))
    names[enumeration as keyof typeof names].add(name);
  return Math.max(names.Opcode.size, names.InlineBuiltin.size);
}

const constant =
  /\b(?:constexpr|const)\s+(?:[\w:]+::)?(?:OpcodeSet|InlineBuiltinSet|std::array<[^;={]*>|(?:Opcode|InlineBuiltin)\s)\s*(\w+)\s*(?:\[\s*\w*\s*\])?\s*(?:=\s*)?\{/g;
const predicate =
  /(?:^|\n)[ \t]*(?:(?:static|inline|constexpr|ALWAYS_INLINE|NEVER_INLINE|friend)\s+)*bool\s+((?:\w+::)*\w+)\s*\(/g;

test.skipIf(!sources)("no list of operations or built-ins that answers a question is new or has grown", () => {
  const found = new Map<string, number>();
  for (const { name, text } of filesOfCompiler()) {
    for (const match of text.matchAll(constant)) {
      const open = match.index + match[0].length - 1;
      found.set(`${name} ${match[1]}`, numberOfNamesIn(text.slice(open, closingOf(text, open))));
    }
    for (const match of text.matchAll(predicate)) {
      const parameters = closingOf(text, match.index + match[0].length - 1);
      const opening = /^\s*(?:const\s*)?(?:noexcept\s*)?\{/.exec(text.slice(parameters + 1));
      if (!opening) continue;
      const open = parameters + opening[0].length;
      const key = `${name} ${match[1]}`;
      found.set(key, Math.max(found.get(key) ?? 0, numberOfNamesIn(text.slice(open, closingOf(text, open)))));
    }
  }
  expect(found.size).toBeGreaterThan(3000);
  const grown = [...found]
    .filter(([key, size]) => size >= 3 && size > (known[key] ?? 0))
    .map(([key, size]) => `${key}: spells ${size}, and ${known[key] ?? 0} are known`);
  expect(grown).toEqual([]);
});

// A function that a column of the schema sends operations to, and that goes by the operation once more.
const switchesBehindColumns = [
  ["valueflow/AOTValueFlowRulesHeap.cpp", "void HeapRule::runOperation(", "flowRule", "Heap"],
  ["valueflow/AOTValueFlowRulesModules.cpp", "void runModuleOperation(", "flowRule", "Module"],
  ["valueflow/AOTValueFlowBodies.cpp", "void describeOperationWithoutRule(", "flowsWithoutRule", "true"],
  ["passes/AOTRingPasses.cpp", "KnownValue evaluateOperation(", "hasKnownValueRule", "true"],
  ["passes/AOTRingPasses.cpp", "bool foldOnce(", "hasOwnFoldingRule", "true"],
] as const;

test.skipIf(!sources)(
  "a switch behind a column of the schema has a case for each operation of the column and no other",
  () => {
    const rows = new Map<string, string>();
    for (const file of new Bun.Glob("ir/schema/*.def").scanSync(sources!))
      for (const [row, name] of readFileSync(join(sources!, file), "utf8").matchAll(
        /^(?:engine )?operation (\w+) .*$/gm,
      ))
        rows.set(name, row);
    expect(rows.size).toBeGreaterThan(300);
    for (const [file, head, column, value] of switchesBehindColumns) {
      const text = withoutCommentsAndLiterals(readFileSync(join(sources!, file), "utf8"));
      const open = text.indexOf("{", text.indexOf(head));
      const [byOperation] = switchesOf(text.slice(open, closingOf(text, open) + 1))
        .map(({ labels }) => labels.filter(label => label.startsWith("Opcode::")).map(label => label.slice(8)))
        .sort((a, b) => b.length - a.length);
      const says = new RegExp(` ; ${column} = ${value}(?: ;|$)`);
      expect({ file, operations: byOperation.sort() }).toEqual({
        file,
        operations: [...rows].flatMap(([name, row]) => (says.test(row) ? [name] : [])).sort(),
      });
    }
  },
);
