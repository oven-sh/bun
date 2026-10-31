// `sabotage=<name>` breaks one thing in a build on purpose: ../sabotages.test.ts says what for. These are the names that a small program notices which runs in the shell
// of the engine, and the program: an IR test below WebKit's aot/tests or below ../engine-tests. ./answers-under-a-sabotage.test.ts builds each with its sabotage.
// Behind the path stand the option words that the program is built with besides, with the sabotage and without.
type Program = string | [path: string, ...optionWords: string[]];

export const noticedInTheShell: Record<string, Program[]> = {
  BirthsEndWithoutALook: [
    "answers/field-deleted-by-next-initializer-is-re-added-last.ir",
  ],
  CallbacksOfOneChainShareNoMemory: ["answers/the-first-callback-of-a-chain-reads-what-the-second-stores.ir"],
  CallsThatThrowHaveNoSite: ["validation/a-call-said-to-throw-may-throw.ir"],
  ChangedClosuresFailEveryTest: ["answers/closure-with-added-property-called-in-two-loops.ir"],
  DelayedStoresAreLeftOut: ["answers/typed-records-with-field-outside-slot.ir"],
  ErasedValuesHaveEffects: ["answers/tested-only-operations-still-run.ir"],
  FieldsNeverChange: ["answers/rarely-escaping-objects.ir"],
  FirstStepsStandUnderHandlers: ["answers/the-first-step-of-a-generator-that-throws-is-caught-where-it-is-taken.ir"],
  FramesAlwaysFit: ["answers/mark-cleared-before-call-on-stack-overflow.ir"],
  FusedGeneratorsAreSeenByOthers: ["answers/a-generator-walked-where-it-is-made-is-asked-again-behind-the-walk.ir"],
  HoistedReadsAreStoredInTheirLoops: [
    "answers/a-variable-of-the-function-above-is-read-anew-in-a-loop-that-has-it-stored.ir",
  ],
  KeysOfStarsAreHeldAsStrings: ["runtime/modules/export-star-getters-read-own-names.ir"],
  LanesHoldWhateverIsComputed: ["answers/typed-array-elements-clamped.ir"],
  NoCallCollects: ["validation/a-store-to-a-marked-owner-has-its-barrier.ir"],
  ProofsOutlastWritesToEverything: ["answers/classes-evaluated-in-loop-capture-own-variables.ir"],
  RangesEndOneEarly: ["answers/loops-leaving-and-rejoining-fast-copy.ir"],
  RemovedLoopsHaveEffects: ["answers/sums-over-program-arrays.ir"],
  SharedPatternsAdvance: ["answers/global-regexp-literal-resets-per-evaluation.ir"],
  SharedPatternsAreSticky: ["answers/sticky-regexp-literal-resets-per-evaluation.ir"],
  SharedPatternsAreUsedInUnknownWays: ["answers/regexp-literal-last-index-read-per-evaluation.ir"],
  SignsOfComparedLanesDoNotMatter: ["answers/max-of-unsigned-typed-array.ir"],
  StepsInCyclesAreFirstSteps: ["answers/a-generator-stepped-in-a-loop-goes-on-where-it-stopped.ir"],
  StoredValuesAreNeverRead: ["answers/stack-frames-of-tail-calling-functions.ir"],
  StoresNeedNoBarrier: ["validation/a-store-to-a-marked-owner-has-its-barrier.ir"],
  StridedIndexesStayInRange: [
    "codegen/claims-to-the-back-end/a-loop-reads-every-second-element-also-past-the-end-passes.ir",
  ],
  SumsOfNumbersAreWhole: ["answers/typed-array-elements-added-to-fraction.ir"],
  TaggedMakersAnswerWithTheirOwnObject: [
    "answers/union-factory-may-return-other-object.ir",
  ],
  TaggedMakersAreOnlyConstructed: [
    "pipeline/union-factory-called-with-existing-object.ir",
  ],
  TailCallsSwapTheirLastArguments: [
    "answers/self-tail-call-passes-operands-in-order.ir",
  ],
  UnfinishedObjectsPassForFinished: ["answers/a-field-deleted-while-its-object-is-filled-is-absent.ir"],
  VectorTurnsMeetNoOtherAccess: [
    "codegen/claims-to-the-back-end/elements-copied-between-views-that-lie-over-each-other-passes.ir",
  ],
  WhatRunsAgainLeavesNoTrace: ["answers/a-count-goes-up-once-in-front-of-each-read-of-a-list-that-ends-early.ir"],
  WritesMayRunTwice: ["answers/what-a-method-says-ahead-of-a-test-that-fails-is-said-once.ir"],
};
