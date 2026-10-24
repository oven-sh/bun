// Objects that lie in the cells of other objects, with the collector at every fifth, seventh and eleventh allocation that leaves the fast path, writing over what it frees.
// A collection at EVERY such allocation (variant-validate-collecting) did not show this fault: an inner object that was let go kept its header in the live cell, and a stale word of the stack
// named it two collections later, when what it referred to was freed. For that the word has to outlast collections, and at every allocation the stack is too fresh:
// programs/inner-objects/three-levels-are-held-let-go-and-filled-again.ts died at every second, third, fifth, seventh and eleventh. At every second and third some of the programs take minutes.
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
