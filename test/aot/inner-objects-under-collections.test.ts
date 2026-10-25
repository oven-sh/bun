// Programs with nested object and array literals, with a collection at every fifth, seventh and eleventh allocation that leaves the fast path, and freed cells overwritten.
// A stale word on the stack shows only if it outlasts collections, so a collection at every allocation finds less. At every second and third some of the programs take minutes.
import { programsBuiltWith } from "./run-programs";

const overwriting = { BUN_JSC_scribbleFreeCells: "1", BUN_JSC_useZombieMode: "1" };
for (const every of [5, 7, 11])
  programsBuiltWith("inner-objects", `a-collection-at-every-${every}`, [], {
    BUN_JSC_slowPathAllocsBetweenGCs: String(every),
    ...overwriting,
  });
programsBuiltWith("inner-objects", "full-collections-only", [], {
  BUN_JSC_useGenerationalGC: "0",
  BUN_JSC_slowPathAllocsBetweenGCs: "40",
  ...overwriting,
});
programsBuiltWith("inner-objects", "no-marking-beside-the-program", [], {
  BUN_JSC_useConcurrentGC: "0",
  BUN_JSC_slowPathAllocsBetweenGCs: "25",
  ...overwriting,
});
// The checks of the run time on code that was built without them. Nothing is written over what is freed: that pattern is zero in half of the bytes of a word, which is what an empty slot of one byte holds.
const checkedByTheRunTime = {
  BUN_JSC_validateAOTRuntime: "1",
  BUN_JSC_useConcurrentGC: "0",
  BUN_JSC_slowPathAllocsBetweenGCs: "10",
};
programsBuiltWith("inner-objects", "checked-by-the-run-time-alone", [], checkedByTheRunTime);
// Every run takes this one. It pushes onto a frozen list, which enters a native function from inside an operation of the run time, in an executable that holds no table of built-ins to judge that function by.
programsBuiltWith("inner-objects", "checked-by-the-run-time-alone-in-every-run", [], checkedByTheRunTime, 1, 1, [
  "an-array-is-born-in-the-cell-of-its-object",
]);
