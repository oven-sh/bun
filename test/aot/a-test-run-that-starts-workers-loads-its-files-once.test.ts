import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// The files that Workers start from are entry points of the one program of a test run. The load looks for them once every file it has found is
// parsed, and goes on with them: it does not throw everything away and load it a second time. Here the first Worker is started by a function of
// another file that gets the URL as a parameter, the second by the first, and the third from a JavaScript file.
const shared: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "src/ask.ts": `export const ask = (url: URL, sent: number) =>
    new Promise<string>((resolve, reject) => {
      const worker = new Worker(url);
      worker.onmessage = event => (resolve(event.data), worker.terminate());
      worker.onerror = event => reject(new Error(event.message));
      worker.postMessage(sent);
    });`,
  "src/first.ts": `import { ask } from "./ask";
    declare var self: Worker;
    console.log("first is main:", import.meta.main);
    self.onmessage = async event => self.postMessage("first " + (await ask(new URL("./second.ts", import.meta.url), event.data + 1)));`,
  "src/second.ts": `import { double } from "./double";
    declare var self: Worker;
    self.onmessage = event => self.postMessage("second " + double(event.data));`,
  "src/double.ts": `export const double = (n: number) => n * 2;`,
  "src/plain.js": `self.onmessage = event => self.postMessage("plain " + event.data);`,
  "a.test.ts": `import { test, expect } from "bun:test";
    import { ask } from "./src/ask";
    test("a Worker that starts a Worker", async () => {
      console.log("the test file is main:", import.meta.main);
      expect(await ask(new URL("./src/first.ts", import.meta.url), 20)).toBe("first second 42");
    });`,
  "b.test.ts": `import { test, expect } from "bun:test";
    import { ask } from "./src/ask";
    import { double } from "./src/double";
    test("a Worker of JavaScript", async () => {
      expect(await ask(new URL("./src/plain.js", import.meta.url), double(4))).toBe("plain 8");
    });`,
};

async function runTests(directory: string, files: string[], flags: string[], words?: string) {
  const env = {
    ...bunEnv,
    BUN_JSC_logAOTPhaseTimes: flags.length ? "1" : undefined,
    BUN_DEBUG_TEST_AOT_WORDS: words,
  };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, ...files], directory, env);
  return {
    results: [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)]
      .map(match => `${match[1]} ${match[2]}`)
      .sort(),
    printed: stdout.split("\n").filter(line => line.includes("is main:")),
    exitCode,
    loadedAgain: [...stderr.matchAll(/^AOT files are loaded again \| (.*)$/gm)].map(match => match[1]),
    goesOn: [...stderr.matchAll(/^AOT load goes on \| (.*)$/gm)].map(match => match[1]),
  };
}

const both = ["./a.test.ts", "./b.test.ts"];
for (const [name, files, taken, words] of [
  ["two test files, one program", both, 3, "TestRunLayers:0"],
  // The only entry point of a program is its main module. With the Worker's file there are two.
  ["one test file, one program", ["./a.test.ts"], 2, "TestRunLayers:0"],
  ["one test file and a Worker of JavaScript", ["./b.test.ts"], 1, "TestRunLayers:0"],
] as const) {
  test(`every file is loaded once: ${name}`, async () => {
    using dir = tempDir("aot-workers-load-once", { ...shared, "tsconfig.json": "{}" });
    const plain = await runTests(String(dir), [...files], []);
    expect(plain).toMatchObject({ exitCode: 0, loadedAgain: [], goesOn: [] });
    expect(plain.results.length).toBe(files.length);
    expect(await runTests(String(dir), [...files], ["--aot"], words)).toEqual({
      ...plain,
      goesOn: [`with ${taken} more files that Workers start from`],
    });
  }, 120_000);
}

test("the layer that the test files share is loaded once", async () => {
  using dir = tempDir("aot-workers-load-once-over-layers", {
    ...shared,
    "tsconfig.json": "{}",
    "src/start.ts": `import { ask } from "./ask";\nexport const start = (n: number) => ask(new URL("./first.ts", import.meta.url), n);`,
    "a.test.ts": `import { test, expect } from "bun:test";
      import { start } from "./src/start";
      test("a Worker that starts a Worker", async () => {
        expect(await start(20)).toBe("first second 42");
      });`,
    "b.test.ts": `import { test, expect } from "bun:test";
      import { start } from "./src/start";
      test("the same from another file", async () => {
        expect(await start(1)).toBe("first second 4");
      });`,
  });
  const plain = await runTests(String(dir), both, []);
  expect(plain).toMatchObject({ exitCode: 0, loadedAgain: [], goesOn: [] });
  expect(await runTests(String(dir), both, ["--aot", "--isolate"], "TestRunLayers:2")).toEqual({
    ...plain,
    goesOn: ["with 2 more files that Workers start from"],
  });
}, 240_000);

test("a JavaScript project without a tsconfig.json", async () => {
  using dir = tempDir("aot-workers-load-once-javascript", {
    "package.json": `{ "type": "module" }`,
    "worker.js": `self.onmessage = event => self.postMessage(event.data + 1);`,
    "a.test.js": `import { test, expect } from "bun:test";
      const file = new URL("./worker.js", import.meta.url).href;
      test("a Worker answers", async () => {
        const worker = new Worker(file);
        const answer = new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
        worker.postMessage(1);
        expect(await answer).toBe(2);
        worker.terminate();
      });`,
  });
  const plain = await runTests(String(dir), ["./a.test.js"], []);
  expect(plain).toMatchObject({ results: ["pass a Worker answers"], exitCode: 0 });
  expect(await runTests(String(dir), ["./a.test.js"], ["--aot"])).toEqual({
    ...plain,
    goesOn: ["with 1 more files that Workers start from"],
  });
}, 120_000);

test("a Worker's file with a mistake in it fails where the Worker starts, as under bun test", async () => {
  using dir = tempDir("aot-workers-load-once-mistake", {
    ...shared,
    "tsconfig.json": "{}",
    "src/first.ts": `postMessage("never" +);`,
    "a.test.ts": `import { test, expect } from "bun:test";
      import { ask } from "./src/ask";
      test("the Worker reports an error", async () => {
        expect(await ask(new URL("./src/first.ts", import.meta.url), 1).then(() => "answered", () => "failed")).toBe("failed");
      });`,
  });
  const plain = await runTests(String(dir), both, []);
  expect(plain).toMatchObject({ exitCode: 0 });
  const compiled = await runTests(String(dir), both, ["--aot"], "TestRunLayers:0");
  expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({
    results: plain.results,
    exitCode: plain.exitCode,
  });
}, 120_000);

// Workers of node:worker_threads are in the program that constructs them, in an executable too.
test("an executable that starts a Worker of node:worker_threads", async () => {
  using dir = tempDir("aot-workers-load-once-executable", {
    "package.json": `{ "type": "module" }`,
    "tsconfig.json": "{}",
    "double.ts": `export const double = (n: number) => n * 2;`,
    "worker.ts": `import { parentPort } from "node:worker_threads";
      import { double } from "./double";
      parentPort!.on("message", (n: number) => parentPort!.postMessage("worker " + double(n) + " " + import.meta.main));`,
    "main.ts": `import { Worker } from "node:worker_threads";
      import { double } from "./double";
      const worker = new Worker(new URL("./worker.ts", import.meta.url));
      worker.on("message", async answer => {
        console.log(answer, import.meta.main);
        await worker.terminate();
      });
      worker.postMessage(double(4));`,
  });
  const plain = await run([bunExe(), "main.ts"], String(dir), bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "worker 16 false true\n", exitCode: 0 });
  const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
  const built = await run([bunExe(), "build", "--compile", "--aot", "--outfile=main", "main.ts"], String(dir), env);
  expect({
    exitCode: built.exitCode,
    loadedAgain: [...built.stderr.matchAll(/^AOT files are loaded again \| (.*)$/gm)].map(match => match[1]),
    goesOn: [...built.stderr.matchAll(/^AOT load goes on \| (.*)$/gm)].map(match => match[1]),
  }).toEqual({ exitCode: 0, loadedAgain: [], goesOn: ["with 1 more files that Workers start from"] });
  const ran = await run([join(String(dir), isWindows ? "main.exe" : "main")], String(dir), bunEnv);
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}, 240_000);
