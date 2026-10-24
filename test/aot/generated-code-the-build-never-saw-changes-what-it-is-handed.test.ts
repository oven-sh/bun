// Fixed seeds of fuzz/code-the-build-never-saw-changes-what-it-is-handed.ts: a program writes a file when it runs, loads it by a path that only the run knows, and hands it instances, records, lists, a Map,
// bytes and closures that compiled code made and goes on reading. The file stores other kinds of values, adds and deletes names, freezes, replaces methods and prototypes, and answers with what was not declared.
import { generate } from "./fuzz/code-the-build-never-saw-changes-what-it-is-handed";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 40 }, (_, index) => index + 1);

generated(
  "what code that the build never saw did to an object is what compiled code reads",
  seeds.map((seed, index) => ({
    name: `seed ${seed}.`,
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    flags: [
      "--aot-allow-code-from-disk",
      ...(index % 3 === 1 ? ["--aot-heat=everything-is-hot"] : index % 3 === 2 ? ["--aot-erase-types"] : []),
    ],
    alsoUnder: [{ BUN_JSC_slowPathAllocsBetweenGCs: "7", BUN_JSC_scribbleFreeCells: "1", BUN_JSC_useZombieMode: "1" }],
    make: () => ({
      file: "main.ts",
      text: generate(new Random(seed)),
      files: {},
    }),
  })),
);
