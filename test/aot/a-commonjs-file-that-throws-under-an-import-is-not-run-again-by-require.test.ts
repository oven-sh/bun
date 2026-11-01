import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A CommonJS file whose body throws goes out of require.cache. The loader of ES modules stays as it is, and a require() that finds nothing in the cache looks there before it reads the file.
// So only a file that nothing but require() has loaded runs again. A file that an import ran keeps its error, and a file that was imported while it ran answers with its namespace object.
// A test run took every such file out of the program and ran it again from disk.
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

// `delete require.cache[path]` takes the file from the loader too, so the next require() runs it again, whoever ran it first.
const takenOut = (name: string, first: string) => `
try {
  ${first};
  say("${name}: loaded");
} catch (error) {
  say("${name}: threw", error.message);
}
for (const round of [1, 2]) {
  delete require.cache[require.resolve("./${name}/file.cjs")];
  try {
    say("${name}: required", round, show(require("./${name}/file.cjs")));
  } catch (error) {
    say("${name}: require threw", round, error.message);
  }
}
say("${name}: imported", Object.keys(await import("./${name}/file.cjs")).join());
`;
const throwsTwice = (name: string) => thrower(name).replace("throw new", `if (runs.${name} < 3) throw new`);
const filesTakenOut: Record<string, string> = {
  "package.json": `{}`,
  "imported/file.cjs": throwsTwice("imported"),
  "imported/module.mjs": importer("imported"),
  "awaited/file.cjs": throwsTwice("awaited"),
  "a.test.mjs": `import { test } from "bun:test";
globalThis.runs = {};
globalThis.say = (...words) => console.log(...words);
const show = value => JSON.stringify(value) + " " + Object.prototype.toString.call(value);
${takenOut("imported", `require("./imported/module.mjs")`)}
${takenOut("awaited", `await import("./awaited/file.cjs")`)}
test("end", () => {});
`,
};

// The file is required, calls import() of the module that imports it, and throws: it goes out of require.cache, and in a test run out of the program. The import() still waits
// then. The loader evaluates the graph once for all such calls and keeps the failure, which a later require() finds there.
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

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`require() runs a CommonJS file that threw again only where no import has loaded the file, ${way}`, async () => {
    using dir = tempDir("aot-a-file-that-throws-under-an-import", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain).toEqual({
      stdout: [
        "required: the file runs 1",
        "required: threw required throws 1",
        "required: the file runs 2",
        "required: require threw 1 required throws 2",
        "required: the file runs 3",
        "required: require threw 2 required throws 3",
        "required: in require.cache false",
        "imported: the file runs 1",
        "imported: threw imported throws 1",
        "imported: require threw 1 imported throws 1",
        "imported: require threw 2 imported throws 1",
        "imported: in require.cache false",
        "awaited: the file runs 1",
        "awaited: threw awaited throws 1",
        "awaited: require threw 1 awaited throws 1",
        "awaited: require threw 2 awaited throws 1",
        "awaited: in require.cache false",
        "below: the file runs 1",
        "below: threw below throws 1",
        "below: require threw 1 below throws 1",
        "below: require threw 2 below throws 1",
        "below: in require.cache false",
        "upward: the file runs 1",
        "upward: the module runs []",
        "upward: loaded",
        "upward: required 1 {} [object Module]",
        "upward: required 2 {} [object Module]",
        "upward: in require.cache true",
        "back: the file runs 1",
        `back: the module runs ["default","value"]`,
        "back: threw back throws 1",
        `back: required 1 {"default":{"value":1},"value":1} [object Module]`,
        `back: required 2 {"default":{"value":1},"value":1} [object Module]`,
        "back: in require.cache true",
        "itself: the file runs 1",
        "itself: the module runs []",
        "itself: loaded",
        "itself: required 1 {} [object Module]",
        "itself: required 2 {} [object Module]",
        "itself: in require.cache true",
        "upward: module.mjs loaded",
        "itself: file.cjs loaded",
      ],
      exitCode: 0,
    });
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);

  test(`a CommonJS file that threw under an import runs again once it is taken out of require.cache, ${way}`, async () => {
    using dir = tempDir("aot-a-file-that-threw-under-an-import-is-taken-out", filesTakenOut);
    const plain = await runTests(String(dir), undefined);
    expect(plain).toEqual({
      stdout: ["imported", "awaited"].flatMap(name => [
        `${name}: the file runs 1`,
        `${name}: threw ${name} throws 1`,
        `${name}: the file runs 2`,
        `${name}: require threw 1 ${name} throws 2`,
        `${name}: the file runs 3`,
        `${name}: required 2 {"value":3} [object Object]`,
        `${name}: imported default,value`,
      ]),
      exitCode: 0,
    });
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);

  test(`an import() that waits when its graph loses a file is answered by the loader, ${way}`, async () => {
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
        "waits: later, require() threw waits throws 4",
        "waits: later, import() threw waits throws 4",
        "waits: later, import() of the module threw waits throws 4",
        "same: the file runs 1",
        "same: require threw 1 same throws 1",
        "same: the file runs 2",
        "same: require threw 2 same throws 2",
        "same: the file runs 3",
        "same: require threw 3 same throws 3",
        "same: file.cjs loaded",
        "same: file.cjs loaded",
        "same: file.cjs loaded",
        "same: later, require() loaded",
        "same: later, import() loaded",
      ],
      exitCode: 0,
    });
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
