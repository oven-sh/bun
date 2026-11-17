import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// The body of a module that several test files import registers a mock. At the end of a test file, `bun test` removes the mocks of that file. The next test file that
// imports the module evaluates it again.
const head = `import { test } from "bun:test";\n`;
const runner = `import { vi } from "bun:test";\n`;
const shared = {
  "tax.js": `export const rate = "real rate";`,
  "fee.js": `export const fee = "real fee";`,
};
const says = (folder: string, name: string, helper: boolean, what: string) =>
  `${helper ? `import "./helper.js";\n` : ""}${head}test("${name}", async () => { console.log("OUT ${folder} ${name}", ${what}); });`;
const rateAndFee = `(await import("./tax.js")).rate, "|", (await import("./fee.js")).fee`;

const folders: Record<string, { files: Record<string, string>; says: string[] }> = {
  // The helper awaits an import() and has registered no mock when the imported module registers one.
  "behind-import": {
    files: {
      "inner.js": `${runner}vi.doMock("./fee.js", () => ({ fee: "mock fee" }));`,
      "helper.js": `${runner}await import("./inner.js");\nvi.doMock("./tax.js", () => ({ rate: "mock rate" }));`,
      "a.test.js": says("behind-import", "a", true, rateAndFee),
      "b.test.js": says("behind-import", "b", true, rateAndFee),
      "z.test.js": says("behind-import", "z", false, rateAndFee),
    },
    says: ["a mock rate | mock fee", "b mock rate | mock fee", "z real rate | real fee"],
  },
  "condition": {
    files: {
      "helper.js": `${runner}if (!globalThis.seen) {\n  globalThis.seen = true;\n  vi.doMock("./tax.js", () => ({ rate: "mock rate" }));\n}`,
      "a.test.js": says("condition", "a", true, `(await import("./tax.js")).rate`),
      "b.test.js": says("condition", "b", true, `(await import("./tax.js")).rate`),
    },
    says: ["a mock rate", "b real rate"],
  },
  "counter": {
    files: {
      "helper.js": `${runner}let n = 0;\nvi.mock("./tax.js", () => ({ n: ++n }));`,
      "a.test.js": says("counter", "a", true, `(await import("./tax.js")).n`),
      "b.test.js": says("counter", "b", true, `(await import("./tax.js")).n`),
    },
    says: ["a 1", "b 1"],
  },
};

// The folders are one project: one run of `bun test` and one compiled run, as one program, which is what a user's flags build.
const project: Record<string, string> = { "package.json": `{ "type": "module" }` };
for (const [folder, { files }] of Object.entries(folders))
  for (const [path, text] of Object.entries({ ...shared, ...files })) project[`${folder}/${path}`] = text;
const testFiles = Object.keys(project)
  .filter(path => path.endsWith(".test.js"))
  .sort()
  .map(path => `./${path}`);

const runs = new Map<string, Promise<string[]>>();
const said = (...flags: string[]) =>
  runs.getOrInsertComputed(flags.join(" "), async () => {
    using directory = tempDir("aot-helper-body-runs-once", project);
    const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: flags.length ? "TestRunLayers:0" : "" };
    const { stdout, stderr } = await run([bunExe(), "test", ...flags, ...testFiles], String(directory), env);
    return (stdout + "\n" + stderr).split("\n").filter(line => /^OUT |^error: /.test(line));
  });
const of = (lines: string[], folder: string) =>
  lines
    .filter(line => !line.startsWith("OUT ") || line.startsWith(`OUT ${folder} `))
    .map(line => line.replace(`OUT ${folder} `, ""));

test.each(Object.keys(folders))("%s", async folder => {
  expect(of(await said(), folder)).toEqual(folders[folder].says);
  expect(of(await said("--aot"), folder)).toEqual(folders[folder].says);
});
