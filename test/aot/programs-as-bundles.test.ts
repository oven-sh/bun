// Programs of ./programs/commonjs and ./programs/modules once more, each as one file: `bun build --target=bun` writes the bundle, in the
// ES module format and in the CommonJS format, and the bundle built with --aot prints what the bundle prints under `bun run`.
// Each of these bundles wraps at least one file in a function that runs it at the first call.
import { expect } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const programs = [
  "commonjs/a-body-throws-ahead-of-the-statement-that-replaces-exports",
  "commonjs/a-class-is-exported-whole-and-a-static-method-is-replaced",
  "commonjs/a-file-on-a-cycle-calls-a-function-that-reads-a-constant-not-yet-made",
  "commonjs/a-file-on-a-cycle-holds-the-exports-object-that-is-replaced-later",
  "commonjs/a-file-on-a-cycle-sees-the-exports-stored-so-far",
  "commonjs/a-function-called-where-it-is-written-returns-ahead-of-a-store-to-exports",
  "commonjs/a-function-declaration-called-ahead-of-its-text-stores-to-exports",
  "commonjs/a-function-is-exported-whole-with-members-of-its-own",
  "commonjs/a-generator-called-where-it-is-written-stores-to-exports-step-by-step",
  "commonjs/a-generator-requires-files-step-by-step",
  "commonjs/a-member-of-a-built-in-module-is-replaced-and-put-back",
  "commonjs/a-return-inside-a-block-with-a-using-declaration",
  "commonjs/a-timer-reads-a-constant-of-a-body-that-threw-ahead-of-it",
  "commonjs/a-timer-reads-the-exports-of-a-body-that-threw-half-way",
  "commonjs/a-timer-reads-what-a-require-that-threw-should-have-filled",
  "commonjs/a-using-declaration-at-the-top-of-a-file-that-exports-and-requires",
  "commonjs/a-using-declaration-whose-disposal-throws-at-the-end-of-the-body",
  "commonjs/a-wrapper-that-asks-for-define-module-and-a-global",
  "commonjs/a-wrapper-that-hands-exports-to-its-factory",
  "commonjs/an-argument-throws-between-two-stores-to-exports",
  "commonjs/an-arrow-called-where-it-is-written-returns-ahead-of-a-store-to-exports",
  "commonjs/an-async-arrow-requires-a-file-behind-an-await",
  "commonjs/an-async-function-called-where-it-is-written-stores-to-exports-behind-an-await",
  "commonjs/another-file-assigns-properties-onto-the-exports",
  "commonjs/another-file-deletes-an-export-and-stores-it-again",
  "commonjs/another-file-freezes-the-exports",
  "commonjs/another-file-gives-the-exports-a-prototype-and-an-heir",
  "commonjs/another-file-stores-to-the-exports-by-a-computed-key",
  "commonjs/another-file-stores-to-the-exports-that-a-third-one-reads",
  "commonjs/another-file-turns-an-export-into-a-getter",
  "commonjs/another-file-wraps-every-exported-function-in-a-loop",
  "commonjs/closures-of-a-file-that-threw-half-way-run-later",
  "commonjs/exported-functions-see-this-in-eight-forms-of-call",
  "commonjs/exports-are-updated-and-added-behind-the-body",
  "commonjs/exports-replaced-in-a-branch-between-two-stores",
  "commonjs/exports-replaced-inside-a-function-called-where-it-is-written",
  "commonjs/exports-replaced-renamed-and-stored-through-three-names",
  "commonjs/global-functions-are-replaced-for-another-file",
  "commonjs/members-of-console-and-process-are-replaced-for-another-file",
  "commonjs/members-of-exports-as-targets-of-patterns-and-loops",
  "commonjs/one-of-two-files-is-exported-whole-and-a-return-skips-the-other",
  "commonjs/one-of-two-files-is-exported-whole-by-an-environment-variable",
  "commonjs/requires-in-optional-chains-that-stop",
  "commonjs/stores-through-this-at-the-top-in-an-arrow-and-in-a-function",
  "commonjs/stores-to-exports-and-a-require-in-the-attributes-and-children-of-an-element",
  "commonjs/stores-to-exports-behind-a-break-or-a-continue",
  "commonjs/stores-to-exports-in-defaults-that-are-not-needed",
  "commonjs/stores-to-exports-in-optional-chains-that-stop",
  "commonjs/stores-to-exports-in-the-parts-of-a-class",
  "commonjs/stores-to-exports-on-the-side-of-a-choice-that-is-not-taken",
  "commonjs/text-made-at-run-time-changes-the-exports",
  "commonjs/the-exports-are-listed-copied-described-and-printed",
  "commonjs/the-factory-of-an-element-throws-behind-a-store-in-an-attribute",
  "commonjs/the-first-exports-object-is-kept-through-arguments",
  "commonjs/the-first-exports-object-is-kept-through-this",
  "commonjs/the-id-filename-loaded-and-path-of-a-module-object-are-stored-to",
  "commonjs/the-main-module-and-the-parent-are-only-tested-in-eight-forms",
  "modules/a-getter-and-a-hidden-property-of-exports-are-imported-by-name",
  "modules/a-helper-copies-the-exports-of-two-files-one-of-them-in-a-branch",
  "modules/an-es-module-is-required-while-its-imports-run",
  "modules/the-es-module-marker-is-set-last-or-in-a-branch",
  "modules/the-main-module-and-the-parent-of-a-file-that-an-es-module-imports",
];

describe.concurrent("compile/aot/programs as bundles", () => {
  for (const program of programs) {
    for (const [format, bundle] of [
      ["esm", "bundle.mjs"],
      ["cjs", "bundle.cjs"],
    ]) {
      test(
        `${program} as ${format}`,
        () =>
          slot(async () => {
            const sources = join(import.meta.dirname, "programs", program);
            const entry = readdirSync(sources).find(name => name.startsWith("main."))!;
            using dir = tempDir("aot-programs-as-bundles", {});
            const folder = String(dir);
            built(
              await spawned(
                [bunExe(), "build", "--target=bun", `--format=${format}`, entry, "--outfile", join(folder, bundle)],
                sources,
                bunEnv,
              ),
            );
            const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
            built(
              await spawned([bunExe(), "build", "--compile", "--aot", bundle, "--outfile", executable], folder, bunEnv),
            );
            const { stdout, exitCode, signal } = await spawned([bunExe(), "run", bundle], folder, bunEnv);
            expect({ isSilent: stdout === "", exitCode, signal }).toEqual({
              isSilent: false,
              exitCode: 0,
              signal: null,
            });
            const compiled = await spawned([executable], folder, bunEnv);
            expect({ stdout: compiled.stdout, exitCode: compiled.exitCode, signal: compiled.signal }).toEqual({
              stdout,
              exitCode,
              signal,
            });
          }),
        600_000,
      );
    }
  }
});
