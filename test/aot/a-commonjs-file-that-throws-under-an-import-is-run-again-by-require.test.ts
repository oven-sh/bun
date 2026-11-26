import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A CommonJS file whose body throws goes out of require.cache, so require() runs it again, as under Node.js. An import that ran it keeps its error.
const thrower = (name: string, middle = "") => `runs.${name} = (runs.${name} ?? 0) + 1;
say("${name}: the file runs", runs.${name});
exports.value = runs.${name};
${middle}
throw new Error("${name} throws " + runs.${name});
`;
const importer = (name: string) => `import * as names from "./file.cjs";
say("${name}: the module runs", JSON.stringify(Object.keys(names)));
`;
const asked = (name: string, first: string) => `
try {
  ${first};
  say("${name}: loaded");
} catch (error) {
  say("${name}: threw", error.message);
}
for (const round of [1, 2]) {
  try {
    say("${name}: required", round, show(require("./${name}/file.cjs")));
  } catch (error) {
    say("${name}: require threw", round, error.message);
  }
}
say("${name}: in require.cache", require.resolve("./${name}/file.cjs") in require.cache);
`;

const files: Record<string, string> = {
  "package.json": `{}`,
  "required/file.cjs": thrower("required"),
  "imported/file.cjs": thrower("imported"),
  "imported/module.mjs": importer("imported"),
  "awaited/file.cjs": thrower("awaited"),
  "below/file.cjs": thrower("below"),
  "below/module.mjs": importer("below"),
  "upward/file.cjs": thrower(
    "upward",
    `import("./module.mjs").then(() => say("upward: module.mjs loaded"), error => say("upward: module.mjs rejected", error.message));`,
  ),
  "upward/module.mjs": importer("upward"),
  "back/file.cjs": thrower("back", `require("./module.mjs");`),
  "back/module.mjs": importer("back"),
  "itself/file.cjs": thrower(
    "itself",
    `import("./file.cjs").then(() => say("itself: file.cjs loaded"), error => say("itself: file.cjs rejected", error.message));`,
  ),
  "itself/module.mjs": importer("itself"),
  "a.test.mjs": `import { test } from "bun:test";
globalThis.runs = {};
globalThis.say = (...words) => console.log(...words);
const show = value => JSON.stringify(value) + " " + Object.prototype.toString.call(value);
${asked("required", `require("./required/file.cjs")`)}
${asked("imported", `require("./imported/module.mjs")`)}
${asked("awaited", `await import("./awaited/file.cjs")`)}
${asked("below", `await import("./below/module.mjs")`)}
${asked("upward", `require("./upward/module.mjs")`)}
${asked("back", `require("./back/file.cjs")`)}
${asked("itself", `require("./itself/module.mjs")`)}
test("end", () => {});
`,
};

// `delete require.cache[path]` takes the file from the loader too: ./fixed-runs/isolated-open/commonjs-file-that-threw-under-an-import-is-taken-out-of-the-cache.txt.

// The file is required, calls import() of the module that imports it, and throws: it goes out of require.cache, and in a test run out of the program. The import() still waits
// then. The loader evaluates the graph once for all such calls and keeps the failure for later imports.
// The test goes on when every import() has settled: the loader reads files on other threads.
const filesWithImportThatWaits: Record<string, string> = {
  "package.json": `{}`,
  "waits/file.cjs": thrower(
    "waits",
    `import("./module.mjs").then(() => settle("waits: module.mjs loaded"), error => settle("waits: module.mjs rejected " + error.message));`,
  ),
  "waits/module.mjs": importer("waits"),
  // The loader is asked for the file while the file runs, so before it goes out of the program.
  "same/file.cjs": thrower(
    "same",
    `import("./file.cjs").then(() => settle("same: file.cjs loaded"), error => settle("same: file.cjs rejected " + error.message));`,
  ),
  "a.test.mjs": `import { test } from "bun:test";
globalThis.runs = {};
globalThis.say = (...words) => console.log(...words);
let settled = 0;
globalThis.settle = words => {
  settled++;
  say(words);
};
const allSettled = async () => {
  while (settled < (runs.waits ?? 0) + (runs.same ?? 0)) await new Promise(resolve => setTimeout(resolve, 1));
};
for (const round of [1, 2, 3]) {
  try {
    say("waits: required", round, require("./waits/file.cjs"));
  } catch (error) {
    say("waits: require threw", round, error.message);
  }
}
await allSettled();
for (const [how, load] of [
  ["require()", () => require("./waits/file.cjs")],
  ["import()", () => import("./waits/file.cjs")],
  ["import() of the module", () => import("./waits/module.mjs")],
]) {
  try {
    await load();
    say("waits: later,", how, "loaded");
  } catch (error) {
    say("waits: later,", how, "threw", error.message);
  }
  await allSettled();
}
for (const round of [1, 2, 3]) {
  try {
    say("same: required", round, require("./same/file.cjs"));
  } catch (error) {
    say("same: require threw", round, error.message);
  }
}
await allSettled();
for (const [how, load] of [
  ["require()", () => require("./same/file.cjs")],
  ["import()", () => import("./same/file.cjs")],
]) {
  try {
    await load();
    say("same: later,", how, "loaded");
  } catch (error) {
    say("same: later,", how, "threw", error.message);
  }
  await allSettled();
}
test("end", () => {});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

test("require() runs a CommonJS file that threw again, whatever ran it first, as one program", async () => {
  using dir = tempDir("aot-a-file-that-throws-under-an-import", files);
  const runsThreeTimes = (name: string, ...inFirstRun: string[]) => [
    `${name}: the file runs 1`,
    ...inFirstRun,
    `${name}: threw ${name} throws 1`,
    `${name}: the file runs 2`,
    `${name}: require threw 1 ${name} throws 2`,
    `${name}: the file runs 3`,
    `${name}: require threw 2 ${name} throws 3`,
    `${name}: in require.cache false`,
  ];
  // The calls of import() end in the order in which the loader has read their files.
  const withCallsSorted = ({ stdout, exitCode }: Awaited<ReturnType<typeof runTests>>) => ({
    stdout: [...stdout.slice(0, -6), ...stdout.slice(-6).sort()],
    exitCode,
  });
  const plain = withCallsSorted(await runTests(String(dir), undefined));
  expect(plain).toEqual({
    stdout: [
      ...runsThreeTimes("required"),
      ...runsThreeTimes("imported"),
      ...runsThreeTimes("awaited"),
      ...runsThreeTimes("below"),
      ...runsThreeTimes("upward"),
      ...runsThreeTimes("back", `back: the module runs ["default","value"]`),
      ...runsThreeTimes("itself"),
      ...Array(3).fill("itself: file.cjs rejected itself throws 1"),
      ...Array(3).fill("upward: module.mjs rejected upward throws 1"),
    ],
    exitCode: 0,
  });
  expect(withCallsSorted(await runTests(String(dir), "TestRunLayers:0", "--aot"))).toEqual(plain);
}, 180_000);

test(`an import() that waits when its graph loses a file is answered by the loader, as one program`, async () => {
  using dir = tempDir("aot-an-import-that-waits-when-its-graph-loses-a-file", filesWithImportThatWaits);
  const plain = await runTests(String(dir), undefined);
  expect(plain).toEqual({
    stdout: [
      "waits: the file runs 1",
      "waits: require threw 1 waits throws 1",
      "waits: the file runs 2",
      "waits: require threw 2 waits throws 2",
      "waits: the file runs 3",
      "waits: require threw 3 waits throws 3",
      "waits: the file runs 4",
      "waits: module.mjs rejected waits throws 4",
      "waits: module.mjs rejected waits throws 4",
      "waits: module.mjs rejected waits throws 4",
      "waits: module.mjs rejected waits throws 4",
      "waits: the file runs 5",
      "waits: later, require() threw waits throws 5",
      "waits: module.mjs rejected waits throws 4",
      "waits: later, import() threw waits throws 4",
      "waits: later, import() of the module threw waits throws 4",
      "same: the file runs 1",
      "same: require threw 1 same throws 1",
      "same: the file runs 2",
      "same: require threw 2 same throws 2",
      "same: the file runs 3",
      "same: require threw 3 same throws 3",
      "same: the file runs 4",
      "same: file.cjs rejected same throws 4",
      "same: file.cjs rejected same throws 4",
      "same: file.cjs rejected same throws 4",
      "same: file.cjs rejected same throws 4",
      "same: the file runs 5",
      "same: later, require() threw same throws 5",
      "same: file.cjs rejected same throws 4",
      "same: later, import() threw same throws 4",
    ],
    exitCode: 0,
  });
  expect(await runTests(String(dir), "TestRunLayers:0", "--aot")).toEqual(plain);
}, 180_000);
