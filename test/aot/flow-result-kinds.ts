import { test } from "bun:test";
import { variant } from "./run-programs";

// The members of FlowResultKind, in enum order (aot/ir/schema/passes.def in WebKit). engine-tests.test.ts compares this list with `testaot list options`.
export const flowResultKinds = [
  "ProvenLayoutSets",
  "NarrowedTypes",
  "RemovedNullish",
  "LiteralValues",
  "ExactFunctions",
  "ProvenContents",
  "ArrayStorageKinds",
  "PristineInstances",
  "ConstantBuiltinLocations",
  "CalleeSets",
  "ReceiverSets",
  "ClassBases",
  "AppendedFields",
  "HolderMutations",
  "OwnNames",
  "ClassEvaluations",
  "StoreCounts",
  "Initialization",
  "ConstructorFieldOrders",
  "OperandSummaries",
  "ObjectUses",
  "ReachedFunctions",
  "ExecutionCounts",
] as const;

const notYet: Partial<Record<(typeof flowResultKinds)[number], string>> = {
  ReachedFunctions:
    "every build, that of console.log(1) too, stops with an internal compiler error (NumberAndEncode: ProgramTableCheckFailed)",
};

/**
 * One result of the flow analysis is switched off at a time. Each result is a true statement about the program, so any subset may be applied: what relied on the missing one takes the
 * tested path, and the answers must be the same. A difference names a result that another one silently depends on.
 */
export function variantsWithoutOneFlowResult(part: number, parts: number) {
  flowResultKinds.forEach((kind, index) => {
    if (index % parts !== part - 1) return;
    if (notYet[kind]) return void test.todo(`compile/aot/variant/without-flow-result/${kind} (${notYet[kind]})`);
    variant(`without-flow-result/${kind}`, [`--aot-disable=flow:${kind}`], {}, part, parts);
  });
}
