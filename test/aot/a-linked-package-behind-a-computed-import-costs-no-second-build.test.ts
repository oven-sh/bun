// pnpm and Bun's isolated linker put a link at node_modules/<name>. A run in layers builds what imports with computed names stand for as a program
// of its own, and begins the project's program beside it, on a guess at the files that it will hold. The guess spelled each file through the
// link, the program holds it under its real path: so the guess failed in every run, and the project's files were loaded and bound twice.
import { expect } from "bun:test";
import { symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { afterAll } from "./harness/default-timeout";
import { waysFor } from "./harness/ways";
import { beforeAll, describe, test } from "./supported";

const files = {
  "package.json": `{ "name": "p" }`,
  "node_modules/.store/tools@1.0.0/node_modules/tools/package.json": `{ "name": "tools", "main": "index.js" }`,
  "node_modules/.store/tools@1.0.0/node_modules/tools/index.js": `exports.name = "tools";\n`,
  "node_modules/.store/tools@1.0.0/node_modules/tools/parts/one.js": `exports.name = "one";\n`,
  "node_modules/.store/tools@1.0.0/node_modules/tools/parts/two.js": `exports.name = "two";\n`,
  "src/load.ts": `import tools from "tools";\nexport const part = async (name: string) => tools.name + " " + (await import(\`tools/parts/\${name}.js\`)).name;\n`,
  "a.test.ts": `import { test } from "bun:test";\nimport { part } from "./src/load";\ntest("a", async () => { console.error("OUT a", await part("one")); });\n`,
  "b.test.ts": `import { test } from "bun:test";\nimport { part } from "./src/load";\ntest("b", async () => { console.error("OUT b", await part("two")); });\n`,
};

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1", BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
  const lines = stderr.split("\n");
  return {
    printed: lines.filter(line => line.startsWith("OUT")).sort(),
    begun: lines.filter(line => line.includes("the build begins: what test files share")).length,
    exitCode,
  };
}

// The build above begins beside the one below on unix alone.
describe.skipIf(isWindows)("the project's program is begun once", () => {
  let folder: ReturnType<typeof tempDir> | undefined;
  let plain: Awaited<ReturnType<typeof run>>;
  beforeAll(async () => {
    folder = tempDir("aot-linked-package-behind-a-computed-import", files);
    const dir = String(folder);
    symlinkSync(join(".store", "tools@1.0.0", "node_modules", "tools"), join(dir, "node_modules", "tools"), "dir");
    plain = await run(dir, ["--isolate"]);
  });
  afterAll(() => folder?.[Symbol.dispose]());

  test("plain Bun", () => {
    expect(plain).toEqual({ printed: ["OUT a tools one", "OUT b tools two"], begun: 0, exitCode: 0 });
  });

  // The guess failed over two layers: that way is the witness. So small a run of two workers asks about no file.
  const ways: [string, string[], string][] = [
    ["two layers", ["--aot", "--isolate"], "TestRunLayers:2"],
    ["three layers", ["--aot", "--isolate"], "TestRunLayers:3"],
    ["two workers, and no memory to spare", ["--aot", "--parallel=2", "--aot-memory-limit=1KB"], ""],
  ];
  test.each([...waysFor(ways, false)])("%s", async (_, flags, words) => {
    expect(await run(String(folder), flags, words)).toEqual({ ...plain, begun: 1 });
  });
});
