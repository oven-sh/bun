// In one turn of a loop a field of an element is tested, stored to and read again (fuzz/a-field-of-an-element-is-tested-stored-to-and-read-again-in-one-turn-of-a-loop.ts), sixteen functions to a program. A run takes few of the programs, others for each commit, so that the commits walk the whole table.
import {
  programOf,
  programs,
} from "./fuzz/a-field-of-an-element-is-tested-stored-to-and-read-again-in-one-turn-of-a-loop";
import { generated } from "./generated/run-generated";

generated(
  "a field of an element is tested, stored to and read again in one turn of a loop",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 25 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: a call in the body of such a loop makes it another loop.
    keepsItsText: true as const,
    make: () => programOf(index),
  })),
);
