import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const lines = [
  `require.cache`,
  `require("node:module")._cache`,
  `console.Console`,
  `Bun.peek(Promise.resolve(1))`,
  `await Bun.$\`echo a\`.text()`,
  `process.env.HOME`,
  `await new Response("a").text()`,
  `await Array.fromAsync(new Blob(["a"]).stream())`,
  `new TransformStream().readable`,
  `await new Response(new Blob(["a"]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer()`,
  `await Bun.file("package.json").text()`,
  `Bun.spawnSync(["true"]).exitCode`,
  `await new Response(Bun.spawn(["echo", "a"]).stdout).text()`,
  `structuredClone({ a: new Map([[1, 2]]) })`,
  `await crypto.subtle.digest("SHA-256", new Uint8Array(1))`,
  `new URL("http://a/b?c=1").searchParams.get("c")`,
  `await new Promise(resolve => setTimeout(resolve, 1))`,
  `await new Promise(resolve => process.nextTick(resolve))`,
  `process.stdout.write("")`,
  `new Intl.NumberFormat("en").format(1)`,
  `[...new Intl.Segmenter("en").segment("ab")].length`,
  `require("node:zlib").gunzipSync(require("node:zlib").gzipSync("a")).toString()`,
  `await require("node:fs/promises").readFile("package.json", "utf8")`,
  `await Array.fromAsync(require("node:fs").createReadStream("package.json"))`,
  `require("node:child_process").spawnSync("true").status`,
  `await new Promise(done => require("node:child_process").execFile("echo", ["a"], (error, out) => done(out)))`,
  `new (require("node:events"))().emit("a")`,
  `await require("node:util").promisify(setTimeout)(1)`,
  `require("node:util").inspect({ a: new Map([[1, { b: 2 }]]) })`,
  `await new (require("node:async_hooks").AsyncLocalStorage)().run(1, async function () { await 0; return 1; })`,
  `require("node:crypto").createHash("sha256").update("a").digest("hex")`,
  `await Array.fromAsync(require("node:stream").Readable.from(["a", "b"]))`,
  `await Array.fromAsync(require("node:readline").createInterface({ input: require("node:stream").Readable.from(["a\\\\nb\\\\n"]) }))`,
  `require("node:assert").deepStrictEqual({ a: 1 }, { a: 1 })`,
  `new (require("bun:sqlite").Database)(":memory:").query("select 1 as a").get()`,
  `require("node:tls").rootCertificates.length`,
  `require("node:https").globalAgent`,
  `require("node:net").isIP("127.0.0.1")`,
  `require("node:worker_threads").isMainThread`,
  `require("node:perf_hooks").performance.timeOrigin`,
  `require("node:v8").getHeapStatistics()`,
];

const all = `[\n${lines.map(line => `  async () => (${line}),`).join("\n")}\n]`;
const kinds = `async all => { const kinds = []; for (const one of all) kinds.push(typeof (await one())); return kinds.join(); }`;
const second = `const { test } = require("bun:test");\ntest("second", () => {});\n`;
const asks = (what: string) =>
  `import { test } from "bun:test";\nimport { through, touch } from "pkg";\ntest("first", async () => {\n  console.log("SEEN", await ${what});\n});\n`;

const places = {
  "in a test file": { "a.test.js": asks(`through(() => (${kinds})(${all}))`) },
  "in a package": { "a.test.js": asks(`touch()`) },
  "in a Worker": {
    "a.test.js": asks(
      `new Promise(done => { new Worker(new URL("./w.js", import.meta.url)).onmessage = event => done(event.data); })`,
    ),
    "w.js": `(${kinds})(${all}).then(kinds => { postMessage(kinds); process.exit(0); });\n`,
  },
};

async function ran(place: keyof typeof places, flags: string[], more: Record<string, string> = {}) {
  using dir = tempDir("aot-nothing-reaches-the-interpreter", {
    "package.json": `{ "name": "p" }`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
    "node_modules/pkg/index.js": `exports.through = f => f();\nexports.touch = () => (${kinds})(${place === "in a package" ? all : "[]"});\n`,
    "b.test.js": second,
    ...places[place],
  });
  const cwd = String(dir);
  const env = { ...bunEnv, [runtimeEnvironment.countsPath]: join(cwd, "counts-%p"), ...more };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], cwd, env);
  return {
    seen: (stdout + stderr).split("\n").filter(line => line.startsWith("SEEN")),
    exitCode,
    interpreted: readdirSync(cwd)
      .filter(name => name.startsWith("counts-"))
      .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"))
      .filter(line => /\tcounter:Interpreted(Function|Global|Eval|Module)Code$/.test(line))
      .reduce((sum, line) => sum + Number(line.split("\t")[0]), 0),
    first: (stdout + stderr).split("\n").filter(line => line.startsWith("crashIfInterpreterIsUsed")),
  };
}

test.each([
  ["in a test file", [], "TestRunLayers:0"],
  ["in a test file", [], "TestRunLayers:2"],
  ["in a test file", ["--isolate"], "TestRunLayers:3"],
  ["in a test file", ["--isolate", "--parallel=2", "--aot-memory-limit=1KB"], ""],
  ["in a package", ["--isolate"], "TestRunLayers:3"],
  ["in a Worker", [], "TestRunLayers:2"],
  ["in a Worker", ["--isolate"], "TestRunLayers:3"],
] as const)("%s %j %s", async (place, flags, words) => {
  const plain = await ran(
    place,
    flags.filter(flag => !flag.startsWith("--aot")),
  );
  expect(plain.seen).toHaveLength(1);
  const compiled = await ran(place, ["--aot", ...flags], { BUN_DEBUG_TEST_AOT_WORDS: words });
  if (compiled.interpreted > 0) {
    const stops = { BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_crashIfInterpreterIsUsed: "1" };
    compiled.first = (await ran(place, ["--aot", ...flags], stops)).first;
  }
  expect(compiled).toEqual({ seen: plain.seen, exitCode: 0, interpreted: 0, first: [] });
});
