import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` reads a file when something first loads it. a.test.js writes state.js anew, and b.test.js, which under --isolate has a realm of
// its own, imports it: it gets the new text. The compiled state.js is the text of the build. The run takes files out of require.cache, so
// the build has compiled state.js as a file that may be read again from disk, and the run looks at the file before it first loads it.
const first = `export let count = 0;\nexport function bump() { return ++count; }\n`;
const files = (newText: string, throughHelper = false): Record<string, string> => ({
  "package.json": `{ "name": "p", "type": "module" }`,
  "state.js": first,
  "helper.js": `import { bump, count } from "./state.js"; export const seen = () => [count, bump(), count].join();`,
  "a.test.js": `
    import { test } from "bun:test";
    import { writeFileSync } from "node:fs";
    test("a", () => {
      const path = require.resolve("./state.js");
      console.log("a", require(path).bump());
      writeFileSync(path, ${JSON.stringify(newText)});
      delete require.cache[path];
    });`,
  "b.test.js": throughHelper
    ? `
    import { test } from "bun:test";
    import { seen } from "./helper.js";
    test("b", () => { console.log("b", seen()); });`
    : `
    import { test } from "bun:test";
    import { bump, count } from "./state.js";
    import * as all from "./state.js";
    test("b", () => { console.log("b", count, bump(), count, Object.keys(all).join()); });`,
});
const newText = `export let count = 100;\nexport function bump() { return count += 10; }\nexport const extra = "new";\n`;

async function runTests(folder: string, flags: string[], words = "", environment: Record<string, string> = {}) {
  writeFileSync(join(folder, "state.js"), first);
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words, ...environment };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  const told = stderr.replaceAll(folder, ".").split("\n");
  return {
    printed: stdout
      .replace(/^bun test .*\n/, "")
      .split("\n")
      .filter(Boolean)
      .sort(),
    told: told
      .filter(line => /^(\((pass|fail)\)|\w*Error:)/.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, ""))
      .sort(),
    exitCode,
  };
}

const ways: [string[], string][] = [
  [[], ""],
  [["--isolate"], "TestRunLayers:0"],
  [["--isolate"], "TestRunLayers:2,TestRunPartFiles:1"],
];

test.concurrent.each(ways)(
  "a later test file imports the new text: %j %s",
  async (flags, words) => {
    using dir = tempDir("a-source-file-written-anew", files(newText));
    const folder = String(dir);
    const plain = await runTests(folder, flags);
    expect(plain.printed).toEqual(["a 1", "b 100 110 110 bump,count,extra"]);
    expect(await runTests(folder, ["--aot", ...flags], words)).toEqual(plain);
  },
  240_000,
);

test.concurrent.each(ways)(
  "through a module that has not run yet: %j %s",
  async (flags, words) => {
    using dir = tempDir("a-source-file-written-anew-helper", files(newText, true));
    const folder = String(dir);
    const plain = await runTests(folder, flags);
    expect(plain.printed).toEqual(["a 1", "b 100,110,110"]);
    expect(await runTests(folder, ["--aot", ...flags], words)).toEqual(plain);
  },
  240_000,
);

test.concurrent.each(ways)(
  "a name that the new text lacks fails the later test file: %j %s",
  async (flags, words) => {
    using dir = tempDir("a-source-file-written-anew-lacks", files(`export let count = 100;\n`));
    const folder = String(dir);
    const plain = await runTests(folder, flags);
    expect(plain.told).toContainEqual(expect.stringContaining("Export named 'bump' not found"));
    expect(await runTests(folder, ["--aot", ...flags], words)).toEqual(plain);
  },
  240_000,
);

// The run hands the system the path of the file as bytes.
test.concurrent(
  "in a folder whose name is not ASCII",
  async () => {
    const name = "gr\u00f6\u00dfe-\u540d";
    const inFolder = Object.fromEntries(
      Object.entries(files(newText)).map(([file, text]) => [`${name}/${file}`, text]),
    );
    using dir = tempDir("a-source-file-written-anew-in-a-folder", inFolder);
    const folder = join(String(dir), name);
    const plain = await runTests(folder, ["--isolate"]);
    expect(plain.printed).toEqual(["a 1", "b 100 110 110 bump,count,extra"]);
    expect(await runTests(folder, ["--aot", "--isolate"], "TestRunLayers:0")).toEqual(plain);
  },
  240_000,
);

// The price, by count: a file is looked at on disk once in a realm, before it first loads there, and only where the run may read it
// again from disk at all. A run that takes nothing out of require.cache looks at no file.
test.concurrent.each([
  ["takes a file out of require.cache", true],
  ["takes nothing out", false],
])(
  "a run that %s",
  async (_, takesFilesOut) => {
    const moduleCount = 12;
    const modules = Object.fromEntries(
      Array.from({ length: moduleCount }, (_, index) => [
        `src/m${index}.js`,
        (index + 1 < moduleCount
          ? `import { v${index + 1} } from "./m${index + 1}.js";\n`
          : `const v${moduleCount} = 0;\n`) + `export const v${index} = ${index} + v${index + 1};\n`,
      ]),
    );
    const testFile = (name: string, more = "") =>
      `import { expect, test } from "bun:test";\nimport { v0 } from "./src/m0.js";\ntest("${name}", () => { expect(v0).toBe(66); ${more} });\n`;
    using dir = tempDir("a-source-file-written-anew-count", {
      "package.json": `{ "type": "module" }`,
      ...modules,
      "a.test.js": testFile("a"),
      "b.test.js": testFile(
        "b",
        takesFilesOut ? `delete require.cache[require.resolve("./" + ["src", "m3.js"].join("/"))];` : "",
      ),
    });
    const cwd = String(dir);
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "--isolate"], cwd, {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0",
      [runtimeEnvironment.countsPath]: join(cwd, "counts-%p"),
    });
    expect({ passes: (stdout + stderr).match(/^ \d+ (pass|fail)$/gm), exitCode }).toEqual({
      passes: [" 2 pass", " 0 fail"],
      exitCode: 0,
    });
    const compared = readdirSync(cwd)
      .filter(name => name.startsWith("counts-"))
      .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"))
      .filter(line => line.endsWith("\tcounter:FilesComparedWithDisk"))
      .reduce((sum, line) => sum + Number(line.split("\t")[0]), 0);
    // Two realms.
    if (takesFilesOut) expect(compared).toBeWithin(1, 2 * moduleCount + 1);
    else expect(compared).toBe(0);
  },
  240_000,
);
