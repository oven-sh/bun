// Flow keeps a list of values for every place in a program. A proof reads everything that may reach the place
// (possibleValuesOf). A prediction reads what the program itself brings there (seenValuesOf), and code that follows a
// prediction tests it at run time. A report that names the place where a value is handed out reads that list too. Goes
// by the text of the engine's sources: each reader names the list it reads, and the files that read the second list are
// listed here.
import { expect, test } from "bun:test";
import { filesOfCompiler, sayWhenSkipped, sources } from "./harness/engine-text";

sayWhenSkipped("test/aot/flow-results-name-the-list-they-read.test.ts");

const filesThatPredict = [
  "valueflow/AOTFlowLiteralOrderResults.cpp",
  "valueflow/AOTLedgerOfClassesAndClosures.cpp",
  "valueflow/AOTValueFlowResultsCalls.cpp",
  "valueflow/AOTValueFlowResultsFunctions.cpp",
  "valueflow/AOTValueFlowResultsHeap.cpp",
  "valueflow/AOTValueFlowResultsInternal.h",
  "valueflow/AOTValueFlowResultsPlaces.cpp",
  "valueflow/AOTValueFlowResultsTypes.cpp",
  "valueflow/AOTValueFlowSolver.h",
];

test.skipIf(!sources)("every reader of the solver's lists says which list it reads", () => {
  const unnamed: string[] = [];
  const predicting: string[] = [];
  let numberOfProofs = 0;
  for (const { name, text } of filesOfCompiler()) {
    if (/[sS]olver(?:\(\))?(?:\.|->)valueOf\s*\(/.test(text)) unnamed.push(name);
    if (/\bseenValuesOf\s*\(/.test(text)) predicting.push(name);
    numberOfProofs += text.match(/\bpossibleValuesOf\s*\(/g)?.length ?? 0;
  }
  expect(unnamed).toEqual([]);
  expect(predicting).toEqual(filesThatPredict);
  expect(numberOfProofs).toBeGreaterThan(100);
});
