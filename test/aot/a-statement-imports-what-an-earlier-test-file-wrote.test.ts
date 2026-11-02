import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// a.test.mjs writes src/made.mjs, and b.test.mjs has `import { two } from "./src/made.mjs"`. `bun test` loads b.test.mjs behind a.test.mjs, so the file is there by then. The
// build finds no file at the path. It leaves the statement to the loader of the run time, which fails as in plain Bun where the file is still missing. Nobody has read what the
// text of the file imports: it may be any file of the run, under any name that the file exports.
const library = `
  export const one = 1;
  export function readByNoCompiledFile(list) { return list.map(x => x * 2); }
  export let count = 0;
  export function bump() { return ++count; }`;
const made = `
  import { one, readByNoCompiledFile, bump } from "./lib.mjs";
  bump();
  export const two = one + 1;
  export default "the default";
  export const list = readByNoCompiledFile([1, 2]);`;

const testFile = (text: string) =>
  `import { test } from "bun:test";\nimport { rmSync, writeFileSync } from "node:fs";\n${text}\ntest("runs", () => {});\n`;
const writes = (path: string, text: string) =>
  `writeFileSync(import.meta.dir + ${JSON.stringify("/" + path)}, ${JSON.stringify(text)});`;
const removes = (path: string) => `rmSync(import.meta.dir + ${JSON.stringify("/" + path)});`;

const projects: Record<string, Record<string, string>> = {
  "names, the default, the namespace and a bare statement": {
    "src/lib.mjs": library,
    "a.test.mjs": testFile(
      `import { bump } from "./src/lib.mjs";\n${writes("src/made.mjs", made)}\nconsole.log("a", bump());`,
    ),
    "b.test.mjs": testFile(`
      import { two, list } from "./src/made.mjs";
      import theDefault, * as names from "./src/made.mjs";
      import "./src/made.mjs";
      import { bump } from "./src/lib.mjs";
      ${removes("src/made.mjs")}
      console.log("b", two, list.join(), theDefault, Object.keys(names).join(), bump());`),
  },
  "export from and export * in files that are no test files": {
    "src/lib.mjs": library,
    "src/names.mjs": `export { two, list, default as renamed } from "./made.mjs";`,
    "src/stars.mjs": `export * from "./made.mjs";\nexport const own = 1;`,
    "a.test.mjs": testFile(writes("src/made.mjs", made)),
    "b.test.mjs": testFile(`
      import { two, list, renamed } from "./src/names.mjs";
      import * as stars from "./src/stars.mjs";
      ${removes("src/made.mjs")}
      console.log("b", two, list.join(), renamed, Object.keys(stars).join());`),
  },
  "a CommonJS file, a file of data and a TypeScript file without its extension": {
    "src/lib.mjs": library,
    "a.test.mjs": testFile(
      [
        writes("src/made.cjs", `exports.name = "cjs"; exports.one = require("./lib.mjs").one;`),
        writes("src/made.json", `{ "name": "json" }`),
        writes("src/typed.ts", `export const typed: number = 5; export type T = number;`),
      ].join("\n"),
    ),
    "b.test.mjs": testFile(`
      import common, { name } from "./src/made.cjs";
      import data from "./src/made.json";
      import { typed } from "./src/typed";
      ${["src/made.cjs", "src/made.json", "src/typed.ts"].map(removes).join("\n")}
      console.log("b", name, common.one, data.name, typed);`),
  },
  "a binding that changes": {
    "a.test.mjs": testFile(writes("src/made.mjs", `export let count = 0; export function bump() { return ++count; }`)),
    "src/keeps-the-folder.mjs": ``,
    "b.test.mjs": testFile(`
      import * as names from "./src/made.mjs";
      import { count, bump } from "./src/made.mjs";
      ${removes("src/made.mjs")}
      bump();
      console.log("b", count, names.count);`),
  },
  "a preload writes the file": {
    "bunfig.toml": `[test]\npreload = ["./setup.mjs"]\n`,
    "setup.mjs": `import { writeFileSync } from "node:fs";\n${writes("src/made.mjs", `export const two = 2;`)}`,
    "src/keeps-the-folder.mjs": ``,
    "b.test.mjs": testFile(`import { two } from "./src/made.mjs";\n${removes("src/made.mjs")}\nconsole.log("b", two);`),
  },
  // The other test files run, and the words are the loader's.
  "nobody writes the file": {
    "a.test.mjs": testFile(`console.log("a");`),
    "b.test.mjs": testFile(`import { two } from "./src/made.mjs";\nconsole.log("b", two);`),
    "c.test.mjs": testFile(`console.log("c");`),
  },
  "the file lacks the name": {
    "src/lib.mjs": library,
    "a.test.mjs": testFile(writes("src/made.mjs", made)),
    "b.test.mjs": testFile(`import { absent } from "./src/made.mjs";\nconsole.log("b", absent);`),
    "c.test.mjs": testFile(`${removes("src/made.mjs")}\nconsole.log("c");`),
  },
  "the file is written between two import() calls of the file with the statement": {
    "src/user.mjs": `export { two } from "./made.mjs";\nconsole.log("user runs");`,
    "a.test.mjs": testFile(`
      try { await import("./src/user.mjs"); } catch (error) { console.log("a", error.constructor.name, error.code); }
      ${writes("src/made.mjs", `export const two = 2;`)}
      try { console.log((await import("./src/user.mjs")).two); } catch (error) { console.log("again", error.constructor.name); }
      ${removes("src/made.mjs")}`),
  },
};

async function runTests(folder: string, flags: string[], words = "") {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], folder, env);
  const said = stderr.replaceAll(folder, ".").split("\n");
  return {
    printed: stdout.replace(/^bun test .*\n/, ""),
    results: said
      .filter(line => /^(\((pass|fail)\)|\w*[Ee]rror:| *\d+ (pass|fail|error))/.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
    exitCode,
  };
}

const printedByPlainBun: Record<string, string> = {
  "names, the default, the namespace and a bare statement": "a 1\nb 2 2,4 the default default,list,two 3\n",
  "export from and export * in files that are no test files": "b 2 2,4 the default list,own,two\n",
  "a CommonJS file, a file of data and a TypeScript file without its extension": "b cjs 1 json 5\n",
  "a binding that changes": "b 1 1\n",
  "a preload writes the file": "b 2\n",
  "nobody writes the file": "a\nc\n",
  "the file lacks the name": "c\n",
};

for (const [name, files] of Object.entries(projects)) {
  test.concurrent(
    name,
    async () => {
      using dir = tempDir("a-statement-imports-a-written-file", { "package.json": `{}`, ...files });
      const folder = String(dir);
      const plain = await runTests(folder, []);
      if (name in printedByPlainBun) expect(plain.printed).toBe(printedByPlainBun[name]);
      expect(await runTests(folder, ["--aot"], "TestRunLayers:0")).toEqual(plain);
    },
    120_000,
  );
}

// Every test file has a realm of its own there, as under --isolate.
test.concurrent(
  "over layers",
  async () => {
    const name = "names, the default, the namespace and a bare statement";
    using dir = tempDir("a-statement-imports-a-written-file-layers", { "package.json": `{}`, ...projects[name] });
    const folder = String(dir);
    const plain = await runTests(folder, ["--isolate"]);
    expect(plain.printed).toBe("a 1\nb 2 2,4 the default default,list,two 2\n");
    expect(await runTests(folder, ["--aot", "--isolate"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
  },
  240_000,
);
