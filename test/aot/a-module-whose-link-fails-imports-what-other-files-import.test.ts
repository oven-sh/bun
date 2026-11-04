import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `export { absent } from "./esm.mjs"` fails where the loader links it. A compiled test run leaves such a file to the loader, which reads it
// from disk and asks for esm.mjs. Another file of the run imports esm.mjs too, so it is compiled, and the loader has to be given it:
// an import() is rejected with the words of `bun test`. The project stands alone: in the company of many test files the fault did not show.
const testFile = (text: string) => `import { test } from "bun:test";\n${text}\ntest("runs", () => {});\n`;

const files: Record<string, string> = {
  "package.json": `{}`,
  "src/esm.mjs": `export const one = 1; export function double(list) { return list.map(x => x * 2); } console.log("esm.mjs runs");`,
  "src/other.mjs": `export const two = 2; console.log("other.mjs runs");`,
  "src/file.cjs": `exports.three = 3; console.log("file.cjs runs");`,
  "src/data.json": `{ "four": 4 }`,
  "src/good.mjs": `
    export { one, double } from "./esm.mjs";
    export { two } from "./other.mjs";
    import common from "./file.cjs";
    import data from "./data.json";
    export const sum = common.three + data.four;
    console.log("good.mjs runs");`,
  "src/exports-absent.mjs": `export { absent } from "./esm.mjs"; console.log("never printed");`,
  "by-import-call.test.mjs": testFile(`
    import { one } from "./src/good.mjs";
    const said = await import("./src/exports-absent.mjs").then(() => "loaded", error => error.name + ": " + error.message);
    console.log("by import():", one, said);`),
};

type Report = { printed: string; byFile: Record<string, string[]>; exitCode: number | null };

async function runTests(folder: string, flags: string[]): Promise<Report> {
  const env = { ...bunEnv, NO_COLOR: "1" };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  const byFile: Record<string, string[]> = {};
  let file = "";
  for (const line of stderr.replaceAll(folder, ".").split("\n")) {
    if (/^\S+\.test\.mjs:$/.test(line)) byFile[(file = line)] = [];
    else if (file && /^(\((pass|fail)\)|\w*[Ee]rror:)/.test(line))
      byFile[file].push(line.replace(/ \[[\d.]+ms\]$/, ""));
  }
  return { printed: stdout.replace(/^bun test .*\n/, ""), byFile, exitCode };
}

test("in a run of one test file", async () => {
  using dir = tempDir("a-module-whose-link-fails-one-file", files);
  const folder = String(dir);
  const plain = await runTests(folder, ["by-import-call"]);
  expect(plain.printed).toContain("by import(): 1 SyntaxError: export 'absent' not found in './esm.mjs'");
  expect(await runTests(folder, ["--aot", "by-import-call"])).toEqual(plain);
});
