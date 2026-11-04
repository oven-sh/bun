// A preload registers `Bun.plugin({ setup(build) { build.onLoad({ filter: /\.custom$/ }, ..) } })`. When it does, a compiled test run leaves every compiled file that matches to the
// loader, which asks the plugin. A file that the program both imports and requires is in the image in two forms, one of them under the path, a question mark and the name of the
// form. The filter was held against that, `$` did not match, and require() ran the compiled raw text of the file where `bun test` hands out the plugin's module.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const raw = `globalThis.RAW = (globalThis.RAW || "") + " raw"; module.exports = { default: "raw" };`;
const files = {
  "bunfig.toml": `[test]\npreload = ["./preload.ts"]`,
  "preload.ts": `
    import { plugin } from "bun";
    plugin({
      name: "custom",
      setup(build) {
        build.onLoad({ filter: /\\.custom$/ }, args => {
          const name = args.path.split("/").pop();
          console.error("OUT the plugin is asked for", name);
          return { contents: "export default " + JSON.stringify("loaded " + name) + ";", loader: "js" };
        });
      },
    });`,
  "a.custom": raw,
  "b.custom": raw,
  "c.custom": raw,
  "d.custom": raw,
  "e.custom": raw,
  "a.test.ts": `
    import { test } from "bun:test";
    import byStatement from "./d.custom";
    const say = async (label: string, f: () => unknown) => { console.error("OUT", label, await f(), (globalThis as any).RAW); };
    test("t", async () => {
      await say("a: import()", async () => (await import("./a.custom")).default);
      await say("a: then require", () => require("./a.custom").default);
      await say("a: then import() again", async () => (await import("./a.custom")).default);
      await say("b: require", () => require("./b.custom").default);
      await say("b: then import()", async () => (await import("./b.custom")).default);
      await say("b: then require again", () => require("./b.custom").default);
      await say("d: a statement", () => byStatement);
      await say("d: then require", () => require("./d.custom").default);
      await say("e: require alone", () => require("./e.custom").default);
    });`,
  "c.test.ts": `import { test } from "bun:test";\ntest("t", async () => { console.error("OUT c: import() in one test file", (await import("./c.custom")).default); });`,
  "c2.test.ts": `import { test } from "bun:test";\ntest("t", () => { console.error("OUT c: require in another", require("./c.custom").default, (globalThis as any).RAW); });`,
};

async function linesOf(flags: string[], words?: string) {
  using dir = tempDir("aot-plugin-file-required", files);
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => /^OUT| pass$| fail$/.test(line)), exitCode };
}

test("require() of a file that the program also imports asks the plugin", async () => {
  const plain = await linesOf([]);
  expect(plain.lines).toContain("OUT a: then require loaded a.custom undefined");
  expect(plain.lines).toContain(" 3 pass");
  expect(await linesOf(["--aot"])).toEqual(plain);
  expect(await linesOf(["--aot"], "TestRunLayers:2")).toEqual(plain);
}, 240_000);
