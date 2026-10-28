// An object with many keys has a name that an object above it has too, and its keys are listed in every way (fuzz/an-object-with-many-keys-and-a-name-that-an-object-above-has-too-is-listed.ts), one case to a program. A run takes a share of the programs.
import { programOf, programs } from "./fuzz/an-object-with-many-keys-and-a-name-that-an-object-above-has-too-is-listed";
import { generated } from "./generated/run-generated";

generated(
  "an object with many keys and a name that an object above has too is listed",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 100 === 0,
    isOnlyCompiled: true as const,
    keepsItsText: true as const,
    make: () => programOf(index),
  })),
);
