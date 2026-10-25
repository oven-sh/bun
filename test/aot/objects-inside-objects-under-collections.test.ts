// Programs with nested object and array literals, with a collection at every fifth, seventh and eleventh allocation that leaves the fast path, and freed cells overwritten.
// A stale word on the stack shows only if it outlasts collections, so a collection at every allocation finds less. At every second and third some of the programs take minutes.
import { programsBuiltWith } from "./run-programs";

const overwriting = { BUN_JSC_scribbleFreeCells: "1", BUN_JSC_useZombieMode: "1" };
for (const every of [5, 7, 11])
  programsBuiltWith("objects-inside-objects", `a-collection-at-every-${every}`, [], {
    BUN_JSC_slowPathAllocsBetweenGCs: String(every),
    ...overwriting,
  });
programsBuiltWith("objects-inside-objects", "full-collections-only", [], {
  BUN_JSC_useGenerationalGC: "0",
  BUN_JSC_slowPathAllocsBetweenGCs: "40",
  ...overwriting,
});
programsBuiltWith("objects-inside-objects", "no-marking-beside-the-program", [], {
  BUN_JSC_useConcurrentGC: "0",
  BUN_JSC_slowPathAllocsBetweenGCs: "25",
  ...overwriting,
});
