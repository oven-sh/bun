import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` finds these mistakes when it transpiles the file, which is when a test loads it. The build of a compiled run found them first and ran no test.
const refused = {
  "mixes.cjs": `import { good } from "./good.ts"; exports.v = good;`,
  "macro-star.ts": `export * from "./good.ts" with { type: "macro" };`,
  "macro-from.ts": `export { good } from "./good.ts" with { type: "macro" };`,
  "bundle-export.ts": `import { nothing } from "bun:bundle"; export const v = nothing;`,
  "feature-count.ts": `import { feature } from "bun:bundle"; export const v = feature() ? 1 : 2;`,
  "feature-number.ts": `import { feature } from "bun:bundle"; export const v = feature(1) ? 1 : 2;`,
  "feature-outside.ts": `import { feature } from "bun:bundle"; export const v = [feature("A")];`,
};
const files = {
  "package.json": `{ "type": "module" }`,
  "src/good.ts": `export const good = "good";`,
  ...Object.fromEntries(Object.entries(refused).map(([name, text]) => ["src/" + name, text])),
  "loads.test.ts": `
    import { test } from "bun:test";
    import { good } from "./src/good.ts";
    const say = (how: string, name: string, said: unknown) => console.log(how, name, String(said));
    ${Object.keys(refused)
      .map(
        name => `test("${name}", async () => {
      try { say("require", "${name}", Object.keys(require("./src/${name}"))); } catch (e) { say("require", "${name}", e?.constructor?.name); }
      try { say("import", "${name}", Object.keys(await import("./src/${name}"))); } catch (e) { say("import", "${name}", e?.constructor?.name); }
    });`,
      )
      .join("\n    ")}
    test("good", () => console.log(good));`,
};

async function runTests(folder: string, flags: string[], words = "") {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], folder, env);
  return { printed: stdout.replace(/^bun test .*\n/, ""), counts: stderr.match(/^ \d+ (pass|fail)$/gm), exitCode };
}

test.each(["", "TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"])(
  "the run prints what bun test prints: %s",
  async words => {
    using dir = tempDir("a-file-that-the-transpiler-refuses", files);
    const folder = String(dir);
    const plain = await runTests(folder, []);
    expect(plain).toMatchObject({ counts: [` ${Object.keys(refused).length + 1} pass`, " 0 fail"], exitCode: 0 });
    expect(plain.printed).toContain("require mixes.cjs BuildMessage");
    expect(await runTests(folder, ["--aot"], words)).toEqual(plain);
  },
  240_000,
);
