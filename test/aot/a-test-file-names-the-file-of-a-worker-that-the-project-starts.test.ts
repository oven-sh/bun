import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { beforeAll, test } from "./supported";

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
    `import { beforeAll, expect, test } from "bun:test";
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
// A file that was compiled answers with what it said when the build read it.
beforeAll(() => {
  for (let n = 1; process.env.WRITES_OVER_WORKERS && n <= ${count}; n++) {
    const file = new URL("./src/worker/w" + n + ".ts", import.meta.url);
    writeFileSync(file, readFileSync(file, "utf8").replace('"w' + n + ' "', '"from disk "'));
  }
});
` +
    // A test for each way. A debug build takes up to a second to start one Worker, and bun:test gives a test five: all eleven in one
    // test ran out of them.
    Object.entries(ways)
      .map(
        ([name, code]) =>
          `test(${JSON.stringify(name)}, async () => { console.log("SEEN " + ${JSON.stringify(name)} + " | " + (await ${code})); });\n`,
      )
      .join("") +
    `test("a file that is only read", () => { expect(read(new URL("./src/only-read.ts", import.meta.url))).toBeGreaterThan(0); });
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
// What a Worker says that starts from the text on disk, once WRITES_OVER_WORKERS has had the test file write over that text.
const fromDisk = Object.keys(ways).map(name => `SEEN ${name} | from disk 42`);

async function see(flags: string[], env: Record<string, string>) {
  using dir = tempDir("aot-worker-named-by-a-test-file", files);
  const command = [bunExe(), "test", ...flags, "--isolate"];
  const ran = await run(command, String(dir), { ...bunEnv, ...env });
  // A crash prints only there. The log of the phases is thousands of lines that say nothing of one.
  if (ran.exitCode !== 0) {
    const withoutLog = ran.stderr.replace(/^(?:AOT |  \w+: wall \d).*\n/gm, "").replace(/\n{3,}/g, "\n\n");
    console.error(
      `bun ${command.slice(1).join(" ")} ${JSON.stringify(env)} exited with ${ran.exitCode}:\n${withoutLog}`,
    );
  }
  return {
    seen: ran.stdout.split("\n").filter(line => line.startsWith("SEEN ")),
    taken: [
      ...ran.stderr.matchAll(
        /^AOT (?:files are loaded again|load goes on) \| with (\d+) more files that Workers start from$/gm,
      ),
    ].map(match => Number(match[1])),
    // How a run with `--aot` says it is built: the first fields of that line. The others say what else such a run holds.
    built: ran.stderr.match(
      /^AOT test run \| ((?:one program|programs without layers|layers \d+)\b[^|]*\| test files \d+(?: \| to a program \d+)?)/m,
    )?.[1],
    // Sorted: in which order the test files run is not asked here.
    results: [...ran.stderr.matchAll(/^(\((?:pass|fail|skip|todo)\) .*?)(?: \[.*\])?$/gm)]
      .map(match => match[1])
      .sort(),
    summary: [
      ...ran.stderr.matchAll(
        /^ *(\d+ (?:pass|fail|skip|todo|expect\(\) calls)|Ran \d+ tests? across \d+ files?\.)(?: \[.*\])?$/gm,
      ),
    ].map(match => match[1]),
    exitCode: ran.exitCode,
  };
}

// What every run reports of the two test files of the project: a test for each way, and two more.
const report = {
  results: [...Object.keys(ways), "a file that is only read", "another file"].map(name => `(pass) ${name}`).sort(),
  summary: [`${count + 2} pass`, "0 fail", "2 expect() calls", `Ran ${count + 2} tests across 2 files.`],
  exitCode: 0,
};

let plain: Awaited<ReturnType<typeof see>>;
let plainWrittenOver: Awaited<ReturnType<typeof see>>;
beforeAll(async () => {
  [plain, plainWrittenOver] = await Promise.all([see([], {}), see([], { WRITES_OVER_WORKERS: "1" })]);
});

test("each Worker answers under plain bun test, and from disk once its file is written over", () => {
  expect(plain).toEqual({ seen: asWritten, taken: [], built: undefined, ...report });
  // Plain Bun reads a file when a Worker starts from it. So in a run that writes over the files, what a Worker says tells one that
  // runs compiled from one that runs from its text.
  expect(plainWrittenOver).toEqual({ ...plain, seen: fromDisk });
});

// Over three layers src/spawn.ts lies in a program below the files that import it, so what its build says goes through the build between.
// To the right of each: how such a run says it is built.
const forms = {
  "TestRunLayers:0": "one program | test files 2",
  "TestRunLayers:2,TestRunPartFiles:1": "layers 2 | test files 2 | to a program 1",
  "TestRunLayers:3,TestRunPartFiles:1": "layers 3 | test files 2 | to a program 1",
};
// Where this Bun loads one program a realm (macOS, Windows, a hardened build) no word brings layers. The run says so behind its first
// field, and the programs of the test files are "programs without layers".
const oneARealm = ": this Bun loads one program a realm";
const withoutLayers = (form: string) =>
  form.replace(/^layers \d+/, "programs without layers").replace(" | ", `${oneARealm} | `);

// A form is built once, for the run that writes over the files: a build is what costs. There each Worker still says what plain bun test
// prints for the files as they were written, which only compiled code does.
for (const [words, form] of Object.entries(forms)) {
  test.concurrent(`each Worker answers as under plain bun test, and runs compiled (${words})`, async () => {
    const env = { BUN_DEBUG_TEST_AOT_WORDS: words, WRITES_OVER_WORKERS: "1", BUN_JSC_logAOTPhaseTimes: "1" };
    const compiled = await see(["--aot"], env);
    const built = compiled.built?.includes(oneARealm) ? withoutLayers(form) : form;
    expect(compiled).toEqual({ ...plain, taken: [count], built });
  });
}
