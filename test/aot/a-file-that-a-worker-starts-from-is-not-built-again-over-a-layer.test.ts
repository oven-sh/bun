import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A test file starts a Worker from a file that the layer below holds, since another test file imports it.
const job = (name: string) => `export const name = "${name}";
export const state = { timesRun: 0 };
state.timesRun++;
if (!Bun.isMainThread) postMessage("ran " + name);
`;

const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "src/mocked-by-url.js": job("mocked-by-url"),
  "src/mocked-by-path.js": job("mocked-by-path"),
  "src/kept.js": job("kept"),
  "src/inner.js": job("inner"),
  "src/outer.js": `export { name } from "./inner.js";\n`,
  "src/embedded.js": job("embedded"),
  "starts.test.js": `import { mock, test } from "bun:test";
import embedded from "./src/embedded.js" with { type: "file" };
const answerOf = worker =>
  new Promise(resolve => {
    worker.onmessage = event => (worker.terminate(), resolve(event.data));
    worker.onerror = event => (worker.terminate(), resolve("error: " + event.message));
  });
const both = async name => [(await import(name)).name, require(name).name];
const isOne = async (written, folder, file) => {
  const computed = await import([folder, file].join("/"));
  return [written === computed, written.state === computed.state, computed.state.timesRun];
};
test("files that Workers start from", async () => {
  console.log("SEEN 1 worker | " + (await answerOf(new Worker(new URL("./src/mocked-by-url.js", import.meta.url)))));
  mock.module(new URL("./src/mocked-by-url.js", import.meta.url).href, () => ({ name: 41 }));
  console.log("SEEN 1 mocked under a URL | " + (await both("./src/mocked-by-url.js")));

  console.log("SEEN 2 worker | " + (await answerOf(new Worker(new URL("./src/mocked-by-path.js", import.meta.url).href))));
  mock.module("./src/mocked-by-path.js", () => ({ name: 42 }));
  console.log("SEEN 2 mocked under a path | " + (await both("./src/mocked-by-path.js")));

  console.log("SEEN 3 worker | " + (await answerOf(new Worker(new URL("./src/kept.js", import.meta.url)))));
  console.log("SEEN 3 one module | " + (await isOne(await import("./src/kept.js"), "./src", "kept.js")));

  console.log("SEEN 4 worker | " + (await answerOf(new Worker(new URL("./src/inner.js", import.meta.url)))));
  console.log("SEEN 4 one module | " + (await isOne(await import("./src/inner.js"), "./src", "inner.js")));

  console.log("SEEN 5 worker | " + (await answerOf(new Worker(embedded))));
  console.log("SEEN 5 one module | " + (await isOne(await import("./src/embedded.js"), "./src", "embedded.js")));
});
`,
  "imports.test.js": `import { test } from "bun:test";
import { name as byUrl } from "./src/mocked-by-url.js";
import { name as byPath } from "./src/mocked-by-path.js";
import { name as kept } from "./src/kept.js";
import { name as inner } from "./src/outer.js";
import { name as embedded } from "./src/embedded.js";
test("the same files, imported", () => {
  console.log("SEEN 6 imported | " + [byUrl, byPath, kept, inner, embedded]);
});
`,
};

async function seenIn(words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-worker-file-of-a-layer-below", files);
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
  const seen = stdout.split("\n").filter(line => line.startsWith("SEEN "));
  return { seen: seen.sort(), exitCode };
}

test("a file that a Worker starts from is one module in every layer", async () => {
  const [plain, one, layers, three] = await Promise.all([
    seenIn(undefined),
    seenIn("TestRunLayers:0", "--aot"),
    seenIn("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
    seenIn("TestRunLayers:3,TestRunPartFiles:8", "--aot"),
  ]);
  expect(plain).toEqual({
    seen: [
      "SEEN 1 mocked under a URL | 41,41",
      "SEEN 1 worker | ran mocked-by-url",
      "SEEN 2 mocked under a path | 42,42",
      "SEEN 2 worker | ran mocked-by-path",
      "SEEN 3 one module | true,true,1",
      "SEEN 3 worker | ran kept",
      "SEEN 4 one module | true,true,1",
      "SEEN 4 worker | ran inner",
      "SEEN 5 one module | true,true,1",
      "SEEN 5 worker | ran embedded",
      "SEEN 6 imported | mocked-by-url,mocked-by-path,kept,inner,embedded",
    ],
    exitCode: 0,
  });
  expect(one).toEqual(plain);
  expect(layers).toEqual(plain);
  expect(three).toEqual(plain);
}, 240_000);
