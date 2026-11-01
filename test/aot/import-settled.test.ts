import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "then.js": `console.log("seen: then.js runs");
export const value = "loaded";
`,
  "bare.js": `console.log("seen: bare.js runs");
globalThis.bare = "ran";
`,
  "outer.js": `console.log("seen: outer.js runs");
globalThis.outer = "outer ran";
import("./inner.js").then(inner => (globalThis.inner = inner.value));
`,
  "inner.js": `console.log("seen: inner.js runs");
export const value = "inner loaded";
`,
  "timer-then.js": `console.log("seen: timer-then.js runs");
setTimeout(() => (globalThis.timerThen = "timer ran"), 0);
`,
  "timer-bare.js": `console.log("seen: timer-bare.js runs");
await new Promise(done => setTimeout(done, 30));
setTimeout(() => (globalThis.timerBare = "timer ran"), 0);
`,
  "throws.js": `console.log("seen: throws.js runs");
throw new Error("thrown by throws.js");
`,
  "throws-alone.js": `console.log("seen: throws-alone.js runs");
throw new Error("thrown by throws-alone.js");
`,
  "computed.js": `console.log("seen: computed.js runs");
export const value = "loaded";
`,
  "waits-then.js": `console.log("seen: waits-then.js runs");
await new Promise(done => setTimeout(done, 30));
export const value = "behind the await";
`,
  "waits-bare.js": `console.log("seen: waits-bare.js runs");
await new Promise(done => setTimeout(done, 30));
globalThis.waitsBare = "behind the await";
`,
  "file.cjs": `console.log("seen: file.cjs runs");
exports.value = "loaded";
`,
  "render.js": `console.log("seen: render.js runs");
export function render() {
  import("./rendered.js").then(rendered => (globalThis.rendered = rendered.value));
}
`,
  "rendered.js": `console.log("seen: rendered.js runs");
export const value = "rendered";
`,
  "forgotten.js": `console.log("seen: forgotten.js runs");
await new Promise(done => setTimeout(done, 60));
globalThis.forgotten = "ran";
`,
  "a.test.js": `import { test, vi } from "bun:test";
import { render } from "./render.js";
const say = (...all) => console.log("seen:", ...all);
const sleep = ms => new Promise(done => setTimeout(done, ms));
test("waits", async () => {
  let seen = "nothing";
  import("./then.js").then(m => (seen = m.value));
  await vi.dynamicImportSettled();
  say("then", seen);

  import("./bare.js");
  await vi.dynamicImportSettled();
  say("bare", globalThis.bare);

  import("./outer.js");
  await vi.dynamicImportSettled();
  say("nested", globalThis.outer, globalThis.inner);

  import("./timer-then.js").then(() => {});
  await vi.dynamicImportSettled();
  import("./timer-bare.js");
  await vi.dynamicImportSettled();
  say("timer of the module", globalThis.timerThen, globalThis.timerBare);

  import("./throws.js").catch(e => (seen = e.message));
  await vi.dynamicImportSettled();
  say("catch", seen);

  import("./comp" + (globalThis.rest ?? "uted") + ".js").then(m => (seen = "computed " + m.value));
  await vi.dynamicImportSettled();
  say(seen);

  import("./waits-then.js").then(m => (seen = m.value));
  import("./waits-bare.js");
  await vi.dynamicImportSettled();
  say("await", seen, globalThis.waitsBare);

  import("./file.cjs").then(m => (seen = "cjs " + m.default.value));
  await vi.dynamicImportSettled();
  say(seen);

  render();
  await vi.dynamicImportSettled();
  say("helper", globalThis.rendered);
});
test("does not wait", async () => {
  import("./forgotten.js").then(() => {});
  vi.resetModules();
  await vi.dynamicImportSettled();
  say("reset", globalThis.forgotten);
  await sleep(150);
  say("reset, later", globalThis.forgotten);
});
`,
  "b.test.js": `import { test, vi } from "bun:test";
test("nobody listens", async () => {
  import("./throws-alone.js");
  await vi.dynamicImportSettled();
});
`,
};

test("vi.dynamicImportSettled() waits for compiled code", async () => {
  using dir = tempDir("aot-import-settled", files);
  const seenWith = async (words: string, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: words,
    });
    return {
      lines: stdout
        .split("\n")
        .filter(line => line.startsWith("seen: "))
        .sort(),
      failed: stderr
        .split("\n")
        .filter(line => /^\(fail\)|^✗|^panic|^error: /.test(line))
        .map(line => line.replace(/ \[[\d.]+m?s\]$/, "")),
      exitCode,
    };
  };
  const [plain, oneProgram, twoLayers, threeLayers] = await Promise.all([
    seenWith("TestRunLayers:0"),
    seenWith("TestRunLayers:0", "--aot"),
    seenWith("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
    seenWith("TestRunLayers:3,TestRunPartFiles:1", "--aot"),
  ]);
  expect(plain.lines).toEqual(
    [
      "seen: then.js runs",
      "seen: then loaded",
      "seen: bare.js runs",
      "seen: bare ran",
      "seen: outer.js runs",
      "seen: inner.js runs",
      "seen: nested outer ran inner loaded",
      "seen: timer-then.js runs",
      "seen: timer-bare.js runs",
      "seen: timer of the module timer ran timer ran",
      "seen: throws.js runs",
      "seen: catch thrown by throws.js",
      "seen: computed.js runs",
      "seen: computed loaded",
      "seen: waits-then.js runs",
      "seen: waits-bare.js runs",
      "seen: await behind the await behind the await",
      "seen: file.cjs runs",
      "seen: cjs loaded",
      "seen: render.js runs",
      "seen: rendered.js runs",
      "seen: helper rendered",
      "seen: forgotten.js runs",
      "seen: reset undefined",
      "seen: reset, later ran",
      "seen: throws-alone.js runs",
    ].sort(),
  );
  expect(plain.failed).toContain("error: thrown by throws-alone.js");
  expect(plain.exitCode).toBe(1);
  expect(oneProgram).toEqual(plain);
  expect(twoLayers).toEqual(plain);
  expect(threeLayers).toEqual(plain);
}, 180_000);
