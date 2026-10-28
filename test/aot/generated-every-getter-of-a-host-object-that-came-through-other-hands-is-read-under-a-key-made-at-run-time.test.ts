// An object that the platform makes reaches a function through hands that nobody follows, and there every accessor up its prototype chain is read under a key that only the run knows (fuzz/every-getter-of-a-host-object-that-came-through-other-hands-is-read-under-a-key-made-at-run-time.ts), one case to a program. A run takes a share of the programs.
import {
  flagsOf,
  programOf,
  programs,
} from "./fuzz/every-getter-of-a-host-object-that-came-through-other-hands-is-read-under-a-key-made-at-run-time";
import { generated } from "./generated/run-generated";

generated(
  "every getter of a host object that came through other hands is read under a key made at run time",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 100 === 0,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: whatever names a member of the object keeps that member.
    keepsItsText: true as const,
    flags: flagsOf(index),
    make: () => programOf(index),
  })),
);
