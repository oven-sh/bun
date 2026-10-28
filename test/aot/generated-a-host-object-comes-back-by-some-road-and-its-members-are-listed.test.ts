// An object of the platform comes back out of something that it was handed to, and then its members are listed, none of them by name (fuzz/a-host-object-comes-back-by-some-road-and-its-members-are-listed.ts), one case to a program. A run takes a share of the programs.
import { programOf, programs } from "./fuzz/a-host-object-comes-back-by-some-road-and-its-members-are-listed";
import { generated } from "./generated/run-generated";

generated(
  "a host object comes back by some road and its members are listed",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 200 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: whatever names a member of the object keeps that member.
    keepsItsText: true as const,
    make: () => programOf(index),
  })),
);
