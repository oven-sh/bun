import { program, tags } from "./generated/objects-of-a-tagged-union-replaced-in-a-loop";
import { generated } from "./generated/run-generated";

generated(
  "objects of a tagged union replaced in a loop",
  tags.map(tag => ({
    name: `${tag[0]}.`,
    isAlwaysRun: ["one and two", "zero and one", "texts"].includes(tag[0]),
    isOnlyCompiled: true as const,
    // Each is compiled as it is written: what a build knows of each loop is what it is about.
    keepsItsText: true as const,
    flags: ["--aot-check=verify-each-pass"],
    make: () => program(tag),
  })),
);
