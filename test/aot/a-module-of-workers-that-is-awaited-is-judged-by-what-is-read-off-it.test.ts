// A library loads node:worker_threads late, with `await import()`: to ask `isMainThread` or `parentPort`, or to start a Worker.
// The build judges the awaited module by what the program reads off it, as it judges `require()` and an import statement.
// It warns (TS100082) where the module object or its promise goes somewhere that it does not follow, and nowhere else, and
// the file of a Worker that is made off the awaited module is in the executable.
// It warned at every `import()` of the module, and left the file of a package's Worker out.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

// A Worker whose file is not in the executable says so at once: the program prints the error where the answer would stand.
const ask = `new Promise(resolve => {
  worker.once("message", resolve);
  worker.once("error", error => resolve("error: " + String(error?.message).split("\\n")[0]));
  worker.once("exit", code => resolve("exit: " + code));
})`;

const files = {
  "program/main.ts": `import { named } from "./named.ts";
import { member } from "./member.ts";
import { held } from "./held.ts";
import { started } from "./started.ts";
import { resolved } from "./resolved.ts";
import { pooled } from "pool";
import { imported } from "imports";
import { handedOn } from "./handed-on.ts";
import { chained } from "./chained.ts";
console.log(JSON.stringify({ named, member, held, started, resolved, pooled, imported, handedOn, chained }));
`,
  "program/named.ts": `const { isMainThread } = await import("node:worker_threads");
export const named = isMainThread;
`,
  "program/member.ts": `export const member = (await import("node:worker_threads")).threadId;
`,
  "program/held.ts": `const threads = await import("worker_threads");
export const held = threads.parentPort;
`,
  "program/started.ts": `const { Worker } = await import("node:worker_threads");
const worker = new Worker(new URL("./answers.ts", import.meta.url));
export const started = await ${ask};
await worker.terminate();
`,
  // The start stands above the load, so the build reads the name of the file where the program asks the resolver for it.
  "program/resolved.ts": `const start = () => new Thread(require.resolve("./answers.ts"));
const { Worker: Thread } = await import("node:worker_threads");
const worker = start();
export const resolved = await ${ask};
await worker.terminate();
`,
  "program/answers.ts": `import { parentPort } from "node:worker_threads";
parentPort!.postMessage("answer");
`,
  // The build reads no path that a package writes elsewhere: the file of this Worker is found at its construction or not at all.
  "program/node_modules/pool/package.json": `{ "name": "pool", "type": "module", "main": "index.js" }`,
  "program/node_modules/pool/index.js": `const { Worker: Thread } = await import("node:worker_threads");
const worker = new Thread(new URL("./job.js", import.meta.url));
export const pooled = await ${ask};
await worker.terminate();
`,
  "program/node_modules/pool/job.js": `import { parentPort } from "node:worker_threads";
parentPort.postMessage("job");
`,
  // The package names the module through its "imports", and keeps the path of the file under a name.
  "program/node_modules/imports/package.json": `{ "name": "imports", "type": "module", "main": "index.js", "imports": { "#threads": "node:worker_threads" } }`,
  "program/node_modules/imports/index.js": `import { join } from "node:path";
const { Worker: Thread } = await import("#threads");
const file = join(import.meta.dirname, "job.js");
const worker = new Thread(file);
export const imported = await ${ask};
await worker.terminate();
`,
  "program/node_modules/imports/job.js": `import { parentPort } from "node:worker_threads";
parentPort.postMessage("job");
`,
  "program/handed-on.ts": `const threads = await import("node:worker_threads");
export const handedOn = Object.keys(threads).includes("Worker");
`,
  "program/chained.ts": `export const chained = await import("node:worker_threads").then(threads => threads.isMainThread);
`,
};

const warnings = (stderr: string) =>
  [...stderr.matchAll(/^warn: (TS\d+): .*\n +at .*[\\/]program[\\/](.+):(\d+):(\d+)$/gm)]
    .map(([, code, file, line, column]) => `${code} ${file.replaceAll("\\", "/")}:${line}:${column}`)
    .sort();

const printedBy = async (cmd: string[], cwd: string, env = bunEnv) => {
  const { stdout, stderr, exitCode } = await run(cmd, cwd, env);
  return { stdout, stderr: exitCode ? stderr : "", exitCode };
};

test("the build warns where the awaited module or its promise is handed on, and holds the file of each Worker", async () => {
  using dir = tempDir("aot-awaited-module-of-workers", files);
  const program = join(String(dir), "program");
  const plain = await printedBy([bunExe(), "main.ts"], program);
  expect(plain).toEqual({
    stdout: `{"named":true,"member":0,"held":null,"started":"answer","resolved":"answer","pooled":"job","imported":"job","handedOn":true,"chained":true}\n`,
    stderr: "",
    exitCode: 0,
  });
  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  // One thread: with more, a debug build of the engine fails about one build in four (#48169).
  const build = [bunExe(), "build", "--compile", "--aot", withThreads(1), "main.ts", "--outfile", executable];
  const built = await run(build, program);
  expect({ warnings: warnings(built.stderr), exitCode: built.exitCode }).toEqual({
    warnings: ["TS100082 chained.ts:1:30", "TS100082 handed-on.ts:2:37"],
    exitCode: 0,
  });
  renameSync(program, join(String(dir), "moved-away"));
  const compiledOnly = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
  expect(await printedBy([executable], String(dir), compiledOnly)).toEqual(plain);
});
