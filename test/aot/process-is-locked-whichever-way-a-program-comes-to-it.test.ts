import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot } from "./harness/commands";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { partOfGrid, runsWholeGrids } from "./harness/ways";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(240_000);

// The compiler folds reads of process.versions, process.release and process.isBun in an executable, so an executable may not store to them: the build warns and the store throws. The
// object is the same whichever way a program comes to it, so the answer has to be the same too. The global object adds its `process` at the first read of that name, and a program that
// imports "node:process" need never read it. A test poses as another runtime, as under plain `bun test`: a test run folds none of the three, and every way stores.
const ways: [string, string, string][] = [
  ["the global name", ``, `process`],
  ["the default import", `import held from "node:process";`, `held`],
  ["the default import without node:", `import held from "process";`, `held`],
  ["the namespace", `import * as names from "node:process";`, `names.default`],
  ["require()", `const held = import.meta.require("node:process");`, `held`],
  ["import()", `const held = (await import("node:process")).default;`, `held`],
  ["an import that is not used", `import "node:process";`, `process`],
];
const names = ["versions", "release", "isBun"];

// The build cannot fold a read by a name that it does not know, so this one tells what the object really holds.
// Every store comes ahead of the first read of the global name.
const body = (object: string, stored = names) =>
  [
    ...stored.map(
      name => `let ${name}How = "stored";
try { ${object}.${name} = 5; } catch (error) { ${name}How = error.constructor.name; }
`,
    ),
    ...stored.map(
      name => `console.log("ANSWER", ${JSON.stringify(name)}, ${name}How, typeof process[[${JSON.stringify(name)}].join(globalThis.neverSet ?? "")]);
`,
    ),
  ].join("");
const cases = ways.map(([way, head, object], index) => ({ way, head, object, file: String(index) }));
// Both faults that this file is about stay. An executable let every way but the first store: a program that does not read the global name first. A test run refused the first alone.
// Each has its witness every day, and the other ways go round.
const witnessAnd = (witness: number) => [
  cases[witness],
  ...partOfGrid(
    "ways to process",
    cases.filter((_, index) => index !== witness),
    6,
    it => it.way,
  ),
];
const files = Object.fromEntries(
  cases.flatMap(({ head, object, file }) => [
    [`${file}.mjs`, `${head}\n${body(object)}`],
    [`${file}.test.mjs`, `import { test } from "bun:test";\n${head}\ntest("a store", () => {\n${body(object)}});\n`],
  ]),
);
files["worker.mjs"] = `import held from "node:process";\n${body("held", ["versions"])}`;
files["starts-a-worker.mjs"] = `const worker = new Worker(new URL("./worker.mjs", import.meta.url).href);
await new Promise(resolve => worker.addEventListener("close", resolve));
`;

const answerIn = (stdout: string) => /^ANSWER (.*)$/m.exec(stdout)?.[1] ?? `no answer in ${JSON.stringify(stdout)}`;

/** For each name, the answers that the ways give, each once. */
async function answers(outputOf: (file: string) => Promise<string>, of: typeof cases) {
  const found: Record<string, string[]> = {};
  const all = await Promise.all(of.map(({ file }) => slot(() => outputOf(file))));
  for (const stdout of all) {
    const given = Array.from(stdout.matchAll(/^ANSWER (.*)$/gm), match => match[1]);
    if (given.length !== names.length) given.push(`incomplete ${JSON.stringify(stdout)}`);
    for (const answer of given) {
      const name = answer.split(" ")[0];
      if (!(found[name] ??= []).includes(answer)) found[name].push(answer);
    }
  }
  return found;
}
const refused = {
  versions: ["versions TypeError object"],
  release: ["release TypeError object"],
  isBun: ["isBun TypeError boolean"],
};
const stored = {
  versions: ["versions stored number"],
  release: ["release stored number"],
  isBun: ["isBun stored number"],
};

test.concurrent("in plain Bun every way stores", async () => {
  using directory = tempDir("process-by-every-way-plain", files);
  const found = await answers(
    async file => (await run([bunExe(), "run", `./${file}.mjs`], String(directory), bunEnv)).stdout,
    cases,
  );
  expect(found).toEqual(stored);
});

test.concurrent("in an executable every way is refused", async () => {
  using directory = tempDir("process-by-every-way-executable", files);
  const runCompiled = async (file: string, ...more: string[]) => {
    const executable = join(String(directory), file + (isWindows ? ".exe" : ".out"));
    const build = [bunExe(), "build", "--compile", "--aot", `./${file}.mjs`, ...more, "--outfile", executable];
    expect(await run(build, String(directory), bunEnv)).toMatchObject({ exitCode: 0 });
    return (await run([executable], String(directory), bunEnv)).stdout;
  };
  expect(await answers(file => runCompiled(file), witnessAnd(1))).toEqual(refused);
  expect(answerIn(await runCompiled("starts-a-worker", "./worker.mjs"))).toBe(refused.versions[0]);
});

for (const [form, words, of] of [
  ["as one program", "TestRunLayers:0", witnessAnd(0)],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1", runsWholeGrids ? cases : cases.slice(0, 1)],
] as const)
  test.concurrent(`in a test run ${form} every way stores`, async () => {
    using directory = tempDir("process-by-every-way-test-run", files);
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
    const found = await answers(async file => {
      const command = [bunExe(), "test", "--timeout=60000", "--aot", `./${file}.test.mjs`];
      const ran = await run(command, String(directory), env);
      if (ran.exitCode !== 0) console.error(ran.stderr);
      return ran.stdout;
    }, of);
    expect(found).toEqual(stored);
  });
