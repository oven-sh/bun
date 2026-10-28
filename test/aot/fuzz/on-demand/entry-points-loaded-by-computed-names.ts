// Every program of fuzz/entry-points-loaded-by-computed-names.ts: a file that is another entry point of the build is loaded by a name that is put
// together at run time, and the executable prints what plain Bun prints.
import { everyProgram } from "../../fuzz/entry-points-loaded-by-computed-names";
import { generated } from "../../generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong = [
  "awaits-once createRequire-in-a-module among-built-in-modules",
  "awaits-once require while-an-import-is-under-way",
  "imports-a-file-that-awaits createRequire-in-a-module among-built-in-modules",
  "imports-a-file-that-awaits createRequire-in-commonjs in-a-job-and-a-timer",
  "is-typescript createRequire-in-commonjs in-a-job-and-a-timer",
  "is-typescript import.meta.require once",
  "loads-a-file-itself import.meta.require after-an-import",
  "loads-a-file-itself import.meta.require-in-typescript after-an-import",
  "rejects import.meta.require-in-typescript once",
  "rejects module.require twice-and-later",
];

generated(
  "entry points are loaded by computed names",
  everyProgram().map(({ name, ...program }, index) => ({
    name: `${name}.`,
    // Every run takes one program in twenty-five; AOT_GENERATED=all takes all.
    isAlwaysRun: index % 25 === 0,
    wasOnceWrong: onceWrong.includes(name),
    isOnlyCompiled: true as const,
    make: () => program,
  })),
);
