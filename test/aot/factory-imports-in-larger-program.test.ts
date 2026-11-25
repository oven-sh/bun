import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./measures";

// The original of a mocked file runs from source. Each of its imports leads to every module of the program, and the running factory books which of them have yet to run.
// A walk over the program for each module of each import shows between the two sizes.
const sizes = [500, 2_000];
const imports = 20;

function project(modules: number) {
  const numbers = Array.from({ length: imports }, (_, index) => index);
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "late.js": `export const late = 0;\n`,
    "original.js": `${numbers.map(index => `import { k${index} } from "./k${index}.js";\n`).join("")}export const sum = () => ${numbers.map(index => `k${index}`).join(" + ")};\n`,
    "sum.test.js": `import { test, vi } from "bun:test";
import { sum } from "./original.js";
vi.mock("./late.js", async importOriginal => ({ ...(await importOriginal()), added: 1 }));
vi.mock("./original.js", async importOriginal => ({ ...(await importOriginal()), added: 1 }));
test("sum", () => {
  console.log("answers", sum());
});
`,
  };
  for (let index = 0; index < modules; index++) {
    const isLast = index + 1 === modules;
    files[`m${index}.js`] = isLast
      ? `import { late } from "./late.js";\nexport const v${index} = late;\n`
      : `import { v${index + 1} } from "./m${index + 1}.js";\nexport const v${index} = v${index + 1} + 1;\n`;
  }
  for (const index of numbers)
    files[`k${index}.js`] = `import { v0 } from "./m0.js";\nexport const k${index} = v0 + ${index};\n`;
  return files;
}

async function load(cwd: string, flags: string[], env: Record<string, string | undefined>) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./sum.test.js"], cwd, {
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
  answers: [`answers ${imports * (modules - 1) + (imports * (imports - 1)) / 2}`],
  counts: [" 1 pass", " 0 fail"],
  exitCode: 0,
});

test.concurrent("what plain Bun answers", async () => {
  using dir = tempDir("aot-factory-imports", project(sizes[0]));
  expect(await load(String(dir), [], {})).toEqual(answersOf(sizes[0]));
});

const sought = new Map<number, number>();

test.concurrent.each(sizes)("a program of %d modules", async modules => {
  using dir = tempDir("aot-factory-imports", project(modules));
  const cwd = String(dir);
  expect(await load(cwd, ["--aot"], { [runtimeEnvironment.countsPath]: join(cwd, "counts-%p") })).toEqual(
    answersOf(modules),
  );
  const lines = readdirSync(cwd)
    .filter(name => name.startsWith("counts-"))
    .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"))
    .filter(line => line.endsWith("\tsought:ModulesScannedForEvaluationStatus"));
  expect(lines.length).toBeGreaterThan(0);
  sought.set(
    modules,
    lines.reduce((sum, line) => sum + Number(line.split("\t")[0]), 0),
  );
});

test("the larger program scans few more modules", () => {
  // A walk for each import over each module: 432,297 against 111,857. One walk for each import: 12,297 against 6,857.
  expect(sought.get(sizes[1])! - sought.get(sizes[0])!).toBeLessThan(40_000);
});
