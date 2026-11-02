import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `writeFileSync(path, text); await import(path)`: the build knows the path and finds no file there, so the loader reads the file when the
// call runs. Nobody has read what the text imports: it may be any file of the run, under any name that the file exports, and it has to be
// the instance that the compiled files share. Each project is a run of its own: one load under a name that nobody knows opens them all.
const library = `
  export const one = 1;
  export function readByNoCompiledFile(list) { return list.map(x => x * 2); }
  export let count = 0;
  export function bump() { return ++count; }`;

const testFile = (text: string) => `import { test } from "bun:test";\n${text}\ntest("runs", () => {});\n`;

const projects: Record<string, Record<string, string>> = {
  "import() of an absolute path": {
    "src/lib.mjs": library,
    "src/file.cjs": `exports.three = 3; exports.readByNoCompiledFile = () => "unread";`,
    "src/data.json": `{ "four": 4, "five": 5 }`,
    "written.test.mjs": testFile(`
      import { rmSync, writeFileSync } from "node:fs";
      import { one, bump } from "./src/lib.mjs";
      import common from "./src/file.cjs";
      import data from "./src/data.json";
      const path = import.meta.dir + "/src/made.mjs";
      writeFileSync(path, \`
        import * as lib from "./lib.mjs";
        import common from "./file.cjs";
        import data from "./data.json";
        import { hostname } from "node:os";
        lib.bump();
        export const two = lib.one + 1;
        export const list = lib.readByNoCompiledFile([1, 2]);
        export const names = Object.keys(lib).join();
        export const rest = common.readByNoCompiledFile() + data.five + typeof hostname();\`);
      bump();
      const made = await import(path).finally(() => rmSync(path));
      console.log(one, common.three, data.four, made.two, made.list.join(), made.names, made.rest, bump());`),
  },
  "require() of a CommonJS file": {
    "src/lib.cjs": `exports.one = 1; exports.readByNoCompiledFile = list => list.map(x => x * 2); let count = 0; exports.bump = () => ++count;`,
    "written.test.cjs": `
      const { test } = require("bun:test");
      const { rmSync, writeFileSync } = require("node:fs");
      const { one, bump } = require("./src/lib.cjs");
      const path = __dirname + "/src/made.cjs";
      writeFileSync(path, \`const lib = require("./lib.cjs"); lib.bump(); exports.two = lib.one + 1; exports.list = lib.readByNoCompiledFile([1, 2]);\`);
      bump();
      let made;
      try { made = require(path); } finally { rmSync(path); }
      console.log(one, made.two, made.list.join(), bump());
      test("runs", () => {});`,
  },
  "one of the names that a loop spells": {
    "src/lib.mjs": library,
    "src/plugin-a.mjs": `export const here = "at the build";`,
    "written.test.mjs": testFile(`
      import { rmSync, writeFileSync } from "node:fs";
      import { one, bump } from "./src/lib.mjs";
      const path = import.meta.dir + "/src/plugin-b.mjs";
      writeFileSync(path, \`import { one, readByNoCompiledFile, bump } from "./lib.mjs"; bump(); export const two = one + 1; export const list = readByNoCompiledFile([1, 2]);\`);
      bump();
      for (const name of ["a", "b"]) {
        const made = await import(\`./src/plugin-\${name}.mjs\`);
        console.log(name, Object.keys(made).join(), made.two, made.list?.join());
      }
      rmSync(path);
      console.log(one, bump());`),
  },
  // The load stands in a file that is no test file, and what the written file imports no test file names.
  "a path from the folder of a helper": {
    "src/inner.mjs": library,
    "src/lib.mjs": `import { one, bump } from "./inner.mjs"; export const two = one + bump();`,
    "src/load.mjs": `export const loadMade = () => import("./made.mjs");`,
    "other.test.mjs": testFile(`import { two } from "./src/lib.mjs"; console.log("other", two);`),
    "written.test.mjs": testFile(`
      import { rmSync, writeFileSync } from "node:fs";
      import { loadMade } from "./src/load.mjs";
      const path = import.meta.dir + "/src/made.mjs";
      writeFileSync(path, \`import { readByNoCompiledFile, bump } from "./inner.mjs"; export const list = readByNoCompiledFile([1, 2]); export const count = bump();\`);
      const made = await loadMade().finally(() => rmSync(path));
      console.log("written", made.list.join(), made.count);`),
  },
};

async function runTests(folder: string, flags: string[], words = "") {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  const said = stderr.replaceAll(folder, ".").split("\n");
  return {
    printed: stdout.replace(/^bun test .*\n/, ""),
    results: said
      .filter(line => /^(\((pass|fail)\)|\w*[Ee]rror:)/.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
    exitCode,
  };
}

const printedByPlainBun: Record<string, string> = {
  "import() of an absolute path": "1 3 4 2 2,4 bump,count,one,readByNoCompiledFile unread5string 3\n",
  "require() of a CommonJS file": "1 2 2,4 3\n",
  "one of the names that a loop spells": "a here undefined undefined\nb list,two 2 2,4\n1 3\n",
  "a path from the folder of a helper": "other 2\nwritten 2,4 2\n",
};

for (const [name, files] of Object.entries(projects)) {
  test(
    name,
    async () => {
      using dir = tempDir("a-module-that-a-test-writes", { "package.json": `{}`, ...files });
      const folder = String(dir);
      const plain = await runTests(folder, []);
      expect(plain.printed).toBe(printedByPlainBun[name]);
      expect(plain.exitCode).toBe(0);
      expect(await runTests(folder, ["--aot"], "TestRunLayers:0")).toEqual(plain);
    },
    120_000,
  );
}

// Every test file has a realm of its own there, as under --isolate.
test("over layers", async () => {
  using dir = tempDir("a-module-that-a-test-writes-layers", {
    "package.json": `{}`,
    ...projects["a path from the folder of a helper"],
  });
  const folder = String(dir);
  const plain = await runTests(folder, ["--isolate"]);
  expect(plain.printed).toBe("other 2\nwritten 2,4 1\n");
  expect(await runTests(folder, ["--aot", "--isolate"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
