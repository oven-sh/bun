import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A test file writes `new URL("./src/worker/w1.ts", import.meta.url)` and hands it to a function of the project, which says `new Worker(entry)`.
// Where the run is built in layers, the project's build doesn't see the test file and the test file's build doesn't read the project. The project's build
// says which parameters of its exports start Workers, and the build above takes a call of such an export for a start.
// A file that nobody compiled runs from its text, in the interpreter, with the right answer, so nobody notices.
const ways: Record<string, string> = {
  "a named import": `start(new URL("./src/worker/w1.ts", import.meta.url))`,
  "the second parameter, beside options": `startSecond("n", new URL("./src/worker/w2.ts", import.meta.url))`,
  "a default export": `startByDefault(new URL("./src/worker/w3.ts", import.meta.url))`,
  "a function that calls the function": `begin(new URL("./src/worker/w4.ts", import.meta.url))`,
  "export * from": `barrel.start(new URL("./src/worker/w5.ts", import.meta.url))`,
  "export { a as b } from": `launch(new URL("./src/worker/w6.ts", import.meta.url))`,
  "the URL in a variable": `start(inVariable)`,
  "a path": `start(join(import.meta.dir, "src", "worker", "w8.ts"))`,
  "an alias of tsconfig.json": `startByAlias(new URL("./src/worker/w9.ts", import.meta.url))`,
  // Only the lowest program holds Bun's own modules. Above it `Worker` of node:worker_threads is still a constructor of Workers.
  "the project starts the Worker of node:worker_threads": `startOfNode(new URL("./src/worker/w10.ts", import.meta.url))`,
  "the test file starts the Worker of node:worker_threads": `askOfNode(new WorkerOfNode(new URL("./src/worker/w11.ts", import.meta.url)))`,
};
const count = Object.keys(ways).length;

const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
  "src/worker/helper.ts": `export const double = (n: number): number => n * 2;\n`,
  "src/spawn.ts": `const ask = (worker: Worker): Promise<string> => new Promise(resolve => { worker.onmessage = event => { resolve(event.data); worker.terminate(); }; worker.postMessage(21); });
export const start = (entry: URL | string) => ask(new Worker(entry));
export function startSecond(name: string, entry: URL) { return ask(new Worker(entry, { name })); }
export default function startByDefault(entry: URL) { return ask(new Worker(entry)); }
`,
  "src/spawn-of-node.ts": `import { Worker } from "node:worker_threads";
export const askOfNode = (worker: Worker): Promise<string> => new Promise(resolve => { worker.on("message", data => { resolve(data); worker.terminate(); }); worker.postMessage(21); });
export const startOfNode = (entry: URL) => askOfNode(new Worker(entry));
`,
  "src/wrap.ts": `import { start } from "./spawn";\nexport const begin = (entry: URL) => start(entry);\n`,
  "src/barrel/index.ts": `export * from "../spawn";\n`,
  "src/renamed.ts": `export { start as launch } from "./barrel";\n`,
  // Most URLs of code files that tests write are there to read a source. No Worker starts from them, so no build takes them in.
  "src/read.ts": `import { readFileSync } from "node:fs";\nexport const read = (file: URL) => readFileSync(file, "utf8").length;\n`,
  "src/only-read.ts": `export const never = "run";\n`,
  "workers.test.ts":
    `import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import startByDefault, { start, startSecond } from "./src/spawn";
import { begin } from "./src/wrap";
import * as barrel from "./src/barrel";
import { launch } from "./src/renamed";
import { start as startByAlias } from "@/spawn";
import { read } from "./src/read";
import { Worker as WorkerOfNode } from "node:worker_threads";
import { askOfNode, startOfNode } from "./src/spawn-of-node";
const inVariable = new URL("./src/worker/w7.ts", import.meta.url);
test("the Workers answer", async () => {
  // A file that was compiled answers with what it said when the build read it.
  for (let n = 1; process.env.WRITES_OVER_WORKERS && n <= ${count}; n++) {
    const file = new URL("./src/worker/w" + n + ".ts", import.meta.url);
    writeFileSync(file, readFileSync(file, "utf8").replace('"w' + n + ' "', '"from disk "'));
  }
` +
    Object.entries(ways)
      .map(([name, code]) => `  console.log("SEEN " + ${JSON.stringify(name)} + " | " + (await ${code}));\n`)
      .join("") +
    `  expect(read(new URL("./src/only-read.ts", import.meta.url))).toBeGreaterThan(0);
});
`,
  "other.test.ts": `import { expect, test } from "bun:test";\ntest("another file", () => { expect(1).toBe(1); });\n`,
};
Object.keys(ways).forEach((name, index) => {
  const n = index + 1;
  files[`src/worker/w${n}.ts`] = name.includes("node:worker_threads")
    ? `import { parentPort } from "node:worker_threads";
import { double } from "./helper";
parentPort!.on("message", (data: number) => { parentPort!.postMessage("w${n} " + double(data)); });
`
    : `import { double } from "./helper";
declare var self: any;
self.onmessage = (event: any) => { self.postMessage("w${n} " + double(event.data)); };
`;
});

const asWritten = Object.keys(ways).map((name, index) => `SEEN ${name} | w${index + 1} 42`);

async function see(flags: string[], env: Record<string, string>) {
  using dir = tempDir("aot-worker-named-by-a-test-file", files);
  const ran = await run([bunExe(), "test", ...flags, "--isolate"], String(dir), { ...bunEnv, ...env });
  return {
    seen: ran.stdout.split("\n").filter(line => line.startsWith("SEEN ")),
    taken: [
      ...ran.stderr.matchAll(
        /^AOT (?:files are loaded again|load goes on) \| with (\d+) more files that Workers start from$/gm,
      ),
    ].map(match => Number(match[1])),
    exitCode: ran.exitCode,
  };
}

// Over three layers src/spawn.ts lies in a program below the files that import it, so what its build says goes through the build between.
for (const words of ["TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1", "TestRunLayers:3,TestRunPartFiles:1"]) {
  test(`each Worker answers as under plain bun test, and runs compiled (${words})`, async () => {
    const plain = await see([], {});
    expect(plain).toEqual({ seen: asWritten, taken: [], exitCode: 0 });
    expect(await see(["--aot"], { BUN_DEBUG_TEST_AOT_WORDS: words })).toEqual(plain);
    const env = { BUN_DEBUG_TEST_AOT_WORDS: words, WRITES_OVER_WORKERS: "1", BUN_JSC_logAOTPhaseTimes: "1" };
    expect(await see(["--aot"], env)).toEqual({ ...plain, taken: [count] });
  }, 240_000);
}
