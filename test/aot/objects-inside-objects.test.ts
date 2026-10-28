import { programs, programsBuiltWith } from "./run-programs";

programs("objects-inside-objects");
programsBuiltWith("objects-inside-objects", "validated", ["--aot-validate"]);
programsBuiltWith("objects-inside-objects", "without-inlining", ["--aot-disable=InlineCalls"]);
programsBuiltWith("objects-inside-objects", "with-freed-cells-overwritten", [], {
  BUN_JSC_slowPathAllocsBetweenGCs: "20",
  BUN_JSC_scribbleFreeCells: "1",
});
programsBuiltWith("objects-inside-objects", "with-the-marks-verified", [], {
  BUN_JSC_verifyGC: "1",
  BUN_JSC_slowPathAllocsBetweenGCs: "50",
});
programsBuiltWith("objects-inside-objects", "while-the-collector-never-rests", [], {
  BUN_JSC_collectContinuously: "1",
});
