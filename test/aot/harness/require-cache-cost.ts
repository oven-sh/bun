// A question to require.cache costs the same however many modules the program has.
//
// `import "ws"` lists "ws" in require.cache: under `bun run` the loader holds what a statement imports. A compiled program has no
// loader to ask, so it follows the statements of the modules that are loaded. That walk is as long as the program. It was made
// for every key that was asked for, nearly all of which are paths of files, and once for each layer of a test run: a preload
// that reads `require.cache[path]` made every test file dearer the larger the run was, and Object.keys(require.cache) cost the
// number of keys times the number of modules.
//
// So one test file asks every kind of question about every file it has loaded, and a hundred about "ws". The run counts the
// modules that it looked at for require.cache. One walk for the list of keys is all that is needed.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "../measures";
import { runtimeEnvironment } from "./flags";
import { run } from "./run";
import { runsWholeGrids } from "./ways";

// Each size pays for "ws" anew. Questions times modules show between the first two.
const sizes = runsWholeGrids ? [250, 1_000, 4_000] : [250, 1_000];

const asks = `import { test } from "bun:test";
import "ws";
import "./all";
test("asks", () => {
  const keys = Object.keys(require.cache);
  const files = keys.filter(key => /m\\d+\\.ts$/.test(key));
  let found = 0;
  for (const key of files) {
    if (key in require.cache) found++;
    if (Object.getOwnPropertyDescriptor(require.cache, key)) found++;
    if (require.cache[key]) found++;
  }
  for (let turn = 0; turn < 100; turn++) if ("ws" in require.cache) found++;
  const absent = ["/nowhere/m1.ts", "undici", "node:fs", "bun:test"].map(key => key in require.cache);
  console.log("answers", files.length, found, keys.includes("ws"), absent.join());
});
`;

function project(modules: number) {
  const files: Record<string, string> = { "package.json": `{ "type": "module" }`, "asks.test.ts": asks };
  const numbers = Array.from({ length: modules }, (_, index) => index);
  for (const index of numbers) files[`m${index}.ts`] = `export const v${index} = ${index};\n`;
  files["all.ts"] = numbers.map(index => `import "./m${index}";\n`).join("");
  return files;
}

async function asked(cwd: string, flags: string[], env: Record<string, string | undefined>) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./asks.test.ts"], cwd, {
    ...bunEnv,
    ...env,
  });
  return {
    answers: stdout.split("\n").filter(line => line.startsWith("answers ")),
    counts: (stdout + stderr).match(/^ \d+ (pass|fail)$/gm),
    exitCode,
  };
}

const answersOf = (modules: number) => ({
  answers: [`answers ${modules} ${3 * modules + 100} true false,false,false,false`],
  counts: [" 1 pass", " 0 fail"],
  exitCode: 0,
});

/**
 * Each size is a compiled run that compiles "ws" and what of Bun's library it stands on, under a sanitizer over a minute of processor
 * time, so the ways are dealt to several test files, and each file makes the plain run for itself. The sizes come one behind the
 * other: beside other files that build, more builds at once only make each test longer.
 */
export function costsTheSameInALargerProgram(way: string, words: string) {
  test("what plain Bun answers", async () => {
    using dir = tempDir("aot-require-cache-questions", project(sizes[0]));
    expect(await asked(String(dir), [], {})).toEqual(answersOf(sizes[0]));
  });

  const sought = new Map<number, number>();

  test.each(sizes)(`${way}, %d modules`, async modules => {
    using dir = tempDir("aot-require-cache-questions", project(modules));
    const cwd = String(dir);
    const compiled = await asked(cwd, ["--aot"], {
      BUN_DEBUG_TEST_AOT_WORDS: words,
      [runtimeEnvironment.countsPath]: join(cwd, "counts-%p"),
    });
    expect(compiled).toEqual(answersOf(modules));
    const lines = readdirSync(cwd)
      .filter(name => name.startsWith("counts-"))
      .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"))
      .filter(line => line.endsWith("\tsought:ModulesForRequireCache"));
    expect(lines.length).toBeGreaterThan(0);
    sought.set(
      modules,
      lines.reduce((sum, line) => sum + Number(line.split("\t")[0]), 0),
    );
  });

  test(`${way}: the modules looked at grow with the program and not with the questions`, () => {
    const [small, middle, large] = sizes.map(modules => sought.get(modules)!);
    // The walk looks at each module of the program once and follows each loaded one once.
    expect(small).toBeGreaterThan(0);
    expect(middle - small).toBeLessThanOrEqual(3 * (sizes[1] - sizes[0]));
    if (large !== undefined) expect(large - middle).toBeLessThanOrEqual(3 * (sizes[2] - sizes[1]));
  });
}
