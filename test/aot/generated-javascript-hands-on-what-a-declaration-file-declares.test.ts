import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import {
  configurations,
  project,
  projectsOfOneCase,
} from "./generated/javascript-hands-on-what-a-declaration-file-declares";
import { spawned } from "./run-programs";
import { describe, test } from "./supported";

// main.ts imports from a JavaScript file, which has what it exports from code that a declaration file describes.
// `bun check` reads the declaration for the import that the JavaScript file writes, and so does the build:
// it stops for a type where `bun check` stops in a TypeScript file, and nowhere else.
// The declaration is not checked against the code, so the executable prints what `bun run` prints even where the two disagree.

const errorsIn = (text: string) =>
  [...text.matchAll(/\bTS\d+\b/g)]
    .map(([code]) => code)
    // A build takes an import without types for `any`.
    .filter(code => code !== "TS7016")
    .sort();

async function ask(files: Record<string, string>) {
  using dir = tempDir("aot-javascript-hands-on", files);
  const folder = String(dir);
  const executable = join(folder, isWindows ? "main.exe" : "main");
  const check = await spawned([bunExe(), "check", "--no-pretty"], folder, bunEnv);
  const build = await spawned(
    [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", executable],
    folder,
    bunEnv,
  );
  const checked = errorsIn(check.stdout + check.stderr);
  const refused = errorsIn(build.stdout + build.stderr);
  if (build.exitCode !== 0) return { checked, refused, exitCodeOfBuild: build.exitCode };
  const plain = await spawned([bunExe(), "run", "./main.ts"], folder, bunEnv);
  const compiled = await spawned([executable], folder, bunEnv);
  return {
    checked,
    refused,
    exitCodeOfBuild: 0,
    plain: { stdout: plain.stdout, exitCode: plain.exitCode },
    compiled: { stdout: compiled.stdout, exitCode: compiled.exitCode },
  };
}

describe.concurrent("every way, extension, place and fit in one project", () => {
  test.each(Object.keys(configurations))(
    "%s",
    async configuration => {
      const answer = await ask(project(configuration));
      expect({ checked: answer.checked, refused: answer.refused, exitCodeOfBuild: answer.exitCodeOfBuild }).toEqual({
        checked: [],
        refused: [],
        exitCodeOfBuild: 0,
      });
      expect(answer.plain!.stdout.split("\n").length).toBeGreaterThan(800);
      expect(answer.compiled).toEqual(answer.plain);
    },
    300_000,
  );
});

// Each way and each place is taken at least once. AOT_GENERATED=all takes every pair.
const alone = Object.entries(projectsOfOneCase());
const taken = process.env.AOT_GENERATED === "all" ? alone : alone.filter((_, index) => index % 3 === 0);

describe.concurrent("the build stops where `bun check` stops", () => {
  test.each(taken)(
    "%s",
    async (_, files) => {
      const answer = await ask(files);
      expect(answer.refused).toEqual(answer.checked);
      expect(answer.exitCodeOfBuild).toBe(answer.checked.length ? 1 : 0);
      expect(answer.compiled).toEqual(answer.plain);
    },
    300_000,
  );
});
