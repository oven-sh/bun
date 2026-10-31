import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
setDefaultTimeout(240_000);

// The compiler folds reads of process.versions, process.release and process.isBun, so a compiled program may not store to them: the build warns and the store throws. The object is
// the same whichever way a program comes to it, so the answer has to be the same too. The global object adds its `process` at the first read of that name, and a program that
// imports "node:process" need never read it.
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
const body = (object: string, name: string) => `let how = "stored";
try { ${object}.${name} = 5; } catch (error) { how = error.constructor.name; }
console.log("ANSWER", ${JSON.stringify(name)}, how, typeof process[[${JSON.stringify(name)}].join(globalThis.neverSet ?? "")]);
`;
const cases = ways.flatMap(([way, head, object], index) =>
  names.map(name => ({ way, name, head, object, file: `${index}-${name}` })),
);
const files = Object.fromEntries(
  cases.flatMap(({ head, object, name, file }) => [
    [`${file}.mjs`, `${head}\n${body(object, name)}`],
    [
      `${file}.test.mjs`,
      `import { test } from "bun:test";\n${head}\ntest("a store", () => {\n${body(object, name)}});\n`,
    ],
  ]),
);
files["worker.mjs"] = `import held from "node:process";\n${body("held", "versions")}`;
files["starts-a-worker.mjs"] = `const worker = new Worker(new URL("./worker.mjs", import.meta.url).href);
await new Promise(resolve => worker.addEventListener("close", resolve));
`;

const answerIn = (stdout: string) => /^ANSWER (.*)$/m.exec(stdout)?.[1] ?? `no answer in ${JSON.stringify(stdout)}`;

/** For each name, the answers that the ways give, each once. */
async function answers(answerOf: (file: string) => Promise<string>) {
  const found: Record<string, string[]> = {};
  const all = await Promise.all(cases.map(async ({ name, file }) => [name, await answerOf(file)]));
  for (const [name, answer] of all) if (!(found[name] ??= []).includes(answer)) found[name].push(answer);
  return found;
}
const refused = {
  versions: ["versions TypeError object"],
  release: ["release TypeError object"],
  isBun: ["isBun TypeError boolean"],
};

test.concurrent("in plain Bun every way stores", async () => {
  using directory = tempDir("process-by-every-way-plain", files);
  const found = await answers(async file =>
    answerIn((await run([bunExe(), "run", `./${file}.mjs`], String(directory), bunEnv)).stdout),
  );
  expect(found).toEqual({
    versions: ["versions stored number"],
    release: ["release stored number"],
    isBun: ["isBun stored number"],
  });
});

test.concurrent("in an executable every way is refused", async () => {
  using directory = tempDir("process-by-every-way-executable", files);
  const runCompiled = async (file: string, ...more: string[]) => {
    const executable = join(String(directory), file + (isWindows ? ".exe" : ".out"));
    const build = [bunExe(), "build", "--compile", "--aot", `./${file}.mjs`, ...more, "--outfile", executable];
    expect(await run(build, String(directory), bunEnv)).toMatchObject({ exitCode: 0 });
    return answerIn((await run([executable], String(directory), bunEnv)).stdout);
  };
  expect(await answers(file => runCompiled(file))).toEqual(refused);
  expect(await runCompiled("starts-a-worker", "./worker.mjs")).toBe(refused.versions[0]);
});

for (const [form, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
])
  test.concurrent(`in a test run ${form} every way is refused`, async () => {
    using directory = tempDir("process-by-every-way-test-run", files);
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
    const found = await answers(async file =>
      answerIn((await run([bunExe(), "test", "--aot", `./${file}.test.mjs`], String(directory), env)).stdout),
    );
    expect(found).toEqual(refused);
  });
