import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./measures";

// A walk through the whole program at each require() shows between the two sizes.
const sizes = [250, 1_000];
const ways = [{ way: "as one program", words: "TestRunLayers:0" }];

function project(modules: number) {
  const numbers = Array.from({ length: modules }, (_, index) => index);
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "shared.ts": `export const one = 1;\n`,
    // The listing of the cache asks once whether this file has run, so there is something to count however little a require asks.
    "never.ts": `export const v = 0;\n`,
    "requires.test.ts": `import { test } from "bun:test";
test("requires", () => {
  let sum = 0;
${numbers.map(index => `  sum += require("./m${index}").v;\n`).join("")}  console.log("answers", sum);
  if (Object.keys(require.cache).length === 0) require("./never");
  delete require.cache[require.resolve("./m" + (sum - sum))];
});
`,
  };
  for (const index of numbers)
    files[`m${index}.ts`] = `import { one } from "./shared";\nexport const v = ${index} + one;\n`;
  return files;
}

async function required(cwd: string, flags: string[], env: Record<string, string | undefined>) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./requires.test.ts"], cwd, {
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
  answers: [`answers ${(modules * (modules + 1)) / 2}`],
  counts: [" 1 pass", " 0 fail"],
  exitCode: 0,
});

test.concurrent("what plain Bun answers", async () => {
  using dir = tempDir("aot-first-requires", project(sizes[0]));
  expect(await required(String(dir), [], {})).toEqual(answersOf(sizes[0]));
});

const sought = new Map<string, number>();

test.concurrent.each(ways.flatMap(way => sizes.map(modules => ({ ...way, modules }))))(
  "$way, $modules modules",
  async ({ way, words, modules }) => {
    using dir = tempDir("aot-first-requires", project(modules));
    const cwd = String(dir);
    const compiled = await required(cwd, ["--aot"], {
      BUN_DEBUG_TEST_AOT_WORDS: words,
      [runtimeEnvironment.countsPath]: join(cwd, "counts-%p"),
    });
    expect(compiled).toEqual(answersOf(modules));
    const lines = readdirSync(cwd)
      .filter(name => name.startsWith("counts-"))
      .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"))
      .filter(line => line.endsWith("\tsought:ModulesScannedForEvaluationStatus"));
    expect(lines.length).toBeGreaterThan(0);
    sought.set(
      `${way} ${modules}`,
      lines.reduce((sum, line) => sum + Number(line.split("\t")[0]), 0),
    );
  },
);

test.each(ways)("$way: a require looks at as many modules in a larger program", ({ way }) => {
  const [small, middle] = sizes.map(modules => sought.get(`${way} ${modules}`)! / modules);
  expect(small).toBeGreaterThan(0);
  expect(middle).toBeLessThanOrEqual(1.5 * small);
});
