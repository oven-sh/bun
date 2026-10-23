// Whether a program may do something at run time is decided by what the program does, never by what else stands in it or by how far the analysis of the build came. Each folder under answer-alike/ holds two programs,
// a.* and b.*, that differ in nothing a programmer could be told a rule about: a line that never runs, the order of two statements, a reference that has been through native code, a limit of the analysis.
// Each executable answers as plain Bun answers for the same program.
//
//   <pair>/a.json, b.json    { "build": [more flags for the build of that program] }
//   <pair>/packages/         becomes node_modules/ beside the programs
//   AOT_GENERATED_FLAGS      more flags for every build, as in ./generated/run-generated.ts
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { cpSync, existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "path";
import { moreFlags } from "./generated/run-generated";
import { built, slot, spawned, told, unsupported, withoutCoreDump } from "./run-programs";

const folder = join(import.meta.dir, "answer-alike");

/** The pairs that try what --aot does not allow in any program. Plain Bun answers both alike, and so do the two executables, in another way. */
const isRefusedInEveryProgram = new Set([
  "a-module-removed-from-the-cache",
  "freeze-of-a-locked-prototype",
  "module-cache-entry-removed",
]);

/** How a pair departs today. It is listed as a todo and not run. */
const failsToday: Record<string, string> = {
  "a-limit-cuts":
    "An import() in evaluated text is refused, and so is the evaluator in a program on which the analysis gave up.",
  "a-module-body-run-by-the-loader-table":
    "The table of loaders of node:module does not run the body of a module that is in the executable.",
  "a-name-computed-by-the-program-and-a-name-in-text":
    "An import() in evaluated text is refused where the same import() in the program works.",
  "another-member-of-a-module-the-program-uses": "An import() in evaluated text is refused.",
  "builtin-module-by-computed-name":
    "A built-in module is in the executable only if a constant name reaches it: an import() of it under a computed name throws ERR_MODULE_NOT_FOUND unless a line names the module.",
  "code-outside-before-and-after-an-external":
    "A file outside the executable loads only after a package that the build left outside was loaded.",
  "evaluated-text-imports":
    "An import() in evaluated text is refused unless the program loads a module by a computed name somewhere.",
  "evaluator-past-the-work-limit": "eval is refused in a function on which the analysis gave up.",
  "evaluator-seen-elsewhere":
    "eval found under a computed name is refused unless the program applies an evaluator somewhere.",
  "host-member-read-elsewhere": "Replacing a member of Bun is refused where a line that never runs reads the member.",
  "host-member-through-unknown-receiver":
    "Replacing a member of Bun through a reference that the compiler cannot follow throws a TypeError where no other line assigns the member.",
  "library-member-named-only-by-text":
    "process.stdout is refused to evaluated text unless the program reads it somewhere.",
  "load-by-name-listing-limit": "getBuiltinModule found under a computed name in a copy of process is refused.",
  "load-by-name-seen-elsewhere":
    "getBuiltinModule found under a computed name is refused unless the program loads a module by a computed name somewhere.",
  "named-in-a-function-nobody-calls": "An import() in evaluated text is refused.",
  "named-nowhere": "An import() in evaluated text is refused.",
  "reached-only-for-a-coarser-analysis": "An import() in evaluated text is refused.",
  "script-declaration-over-a-global-read-elsewhere":
    "A script may not declare the name of a global function where a line that never runs calls the function.",
  "sloppy-store-to-a-locked-member":
    "A store to a locked method throws in strict code and does nothing in sloppy code.",
  "text-that-the-build-can-read": "An import() in evaluated text is refused.",
  "the-analysis-is-off":
    "An import() in evaluated text is refused unless the results of the analysis are switched off.",
  "the-fallback-idiom":
    "A require() that is handed to evaluated text does not load a module that the program never names.",
  "typed-place-in-a-package-with-a-type-error":
    "A type error in one function of a file switches off the run-time type checks of the whole file.",
  "what-a-failed-run-let-out":
    "A closure that the failed first run of a module body let out works on the variables of the second run.",
};

async function answersOf(root: string, side: "a" | "b") {
  const entry = readdirSync(root).find(name => new RegExp(`^${side}\\.(mjs|cjs|js|ts)$`).test(name))!;
  const options = join(root, `${side}.json`);
  const flags: string[] = existsSync(options) ? JSON.parse(readFileSync(options, "utf8")).build : [];
  const executable = join(root, `program-${side}${isWindows ? ".exe" : ""}`);
  const plain = await spawned([bunExe(), "run", entry], root, bunEnv);
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", ...moreFlags, ...flags, entry, "--outfile", executable],
      root,
      bunEnv,
    ),
  );
  const compiled = await spawned(withoutCoreDump([executable]), root, bunEnv);
  expect(compiled.signal).toBeNull();
  const answer = (run: typeof plain) => ({ ...told(run), stdout: run.stdout.trim() });
  return { plain: answer(plain), compiled: answer(compiled) };
}

describe.concurrent("compile/aot/answer alike", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  for (const pair of readdirSync(folder).sort()) {
    if (failsToday[pair]) {
      test.todo(pair);
      continue;
    }
    test(
      pair,
      async () => {
        using dir = tempDir("aot-answer-alike", {});
        const root = String(dir);
        cpSync(join(folder, pair), root, { recursive: true });
        if (existsSync(join(root, "packages"))) renameSync(join(root, "packages"), join(root, "node_modules"));
        const [a, b] = await Promise.all([slot(() => answersOf(root, "a")), slot(() => answersOf(root, "b"))]);
        if (isRefusedInEveryProgram.has(pair)) expect(a).toEqual(b);
        else expect({ a: a.compiled, b: b.compiled }).toEqual({ a: a.plain, b: b.plain });
      },
      600_000,
    );
  }
});
