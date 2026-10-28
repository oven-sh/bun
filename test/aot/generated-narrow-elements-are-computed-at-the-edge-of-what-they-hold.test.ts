// A short loop computes every element of a typed array of whole numbers anew, with limits and intermediate values at the edge of what an element holds (fuzz/narrow-elements-are-computed-at-the-edge-of-what-they-hold.ts), twenty cases to a program. A run takes a share of the programs.
import { flagsOf, programOf, programs } from "./fuzz/narrow-elements-are-computed-at-the-edge-of-what-they-hold";
import { generated } from "./generated/run-generated";

generated(
  "narrow elements are computed at the edge of what they hold",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 100 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: a call inside the loop makes it another loop.
    keepsItsText: true as const,
    flags: flagsOf(index),
    make: () => programOf(index),
  })),
);
