// A short loop does one thing to every element of a list of numbers or of a typed array while other code runs around it (fuzz/one-thing-is-done-to-every-element-while-other-code-runs-around-the-loop.ts), twenty cases to a program. A run takes a share of the programs.
import {
  flagsOf,
  programOf,
  programs,
} from "./fuzz/one-thing-is-done-to-every-element-while-other-code-runs-around-the-loop";
import { generated } from "./generated/run-generated";

generated(
  "one thing is done to every element while other code runs around the loop",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 300 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: a call inside the loop makes it another loop.
    keepsItsText: true as const,
    flags: flagsOf(index),
    make: () => programOf(index),
  })),
);
