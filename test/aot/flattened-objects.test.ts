import { programs, programsBuiltWith } from "./run-programs";

programs("flattened-objects");

// The form that keeps the field, with a slot that says whether the inner object was made, is taken by an estimate of heat, which keeps it out of most small programs.
// Here every field that may take it does, also where nobody holds the inner object. The programs that are about this form alone name the switch in their .json.
const whereverLegal = ["--aot-testing=FlattenUntilHeldWhereverLegal"];
programsBuiltWith("flattened-objects", "wherever-legal", whereverLegal);
programsBuiltWith("flattened-objects", "wherever-legal-and-validated", [...whereverLegal, "--aot-validate"]);
programsBuiltWith("flattened-objects", "wherever-legal-without-inlining", [...whereverLegal, "--aot-disable=InlineCalls"]);
programsBuiltWith("flattened-objects", "wherever-legal-with-freed-cells-overwritten", whereverLegal, { BUN_JSC_slowPathAllocsBetweenGCs: "20", BUN_JSC_scribbleFreeCells: "1" });
programsBuiltWith("flattened-objects", "wherever-legal-with-the-marks-verified", whereverLegal, { BUN_JSC_verifyGC: "1", BUN_JSC_slowPathAllocsBetweenGCs: "50" });
programsBuiltWith("flattened-objects", "wherever-legal-while-the-collector-never-rests", whereverLegal, { BUN_JSC_collectContinuously: "1" });
