import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test --aot` compiles what the test files share as programs of their own, below the test files.
// A data file that a test file and the project both import is one module: one object, one namespace. Under a type of its own it is what that type says.
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": "{}",
  "data/shared.json": `{ "name": "shared", "list": [1, 2], "default": "a default of its own" }
`,
  "data/own.json": `{ "name": "own", "list": [3] }
`,
  "data/typed.json": `{ "name": "typed" }
`,
  "data/shared.txt": `shared text
`,
  "data/own.txt": `own text
`,
  "data/shared.toml": `a = 1
[b]
c = "two"
`,
  "data/own.toml": `a = 2
`,
  "data/shared.yaml": `a: 1
b:
  - two
`,
  "src/as-text.js": `export const code = 1;
`,
  "src/both-ways.js": `export const code = 2;
`,
  "src/app.mjs": `import json from "../data/shared.json";
import * as jsonSpace from "../data/shared.json";
import text from "../data/shared.txt";
import toml from "../data/shared.toml";
import yaml from "../data/shared.yaml";
import typedText from "../data/typed.json" with { type: "text" };
import { code } from "./both-ways.js";
export const held = { json, jsonSpace, text, toml, yaml, typedText, code };
`,
  "src/app.cjs": `exports.held = { json: require("../data/shared.json"), toml: require("../data/shared.toml"), text: require("../data/shared.txt") };
`,
  "json.test.js": `import { test } from "bun:test";
const hidden = text => JSON.parse(JSON.stringify(text));
const show = value => JSON.stringify(value);
const tag = value => Object.prototype.toString.call(value);
import json, { name, list } from "./data/shared.json";
import * as jsonSpace from "./data/shared.json";
import { held as esm } from "./src/app.mjs";
import cjs from "./src/app.cjs";
test("json", async () => {
  console.log("json", show(json), name, show(list), Object.keys(jsonSpace).join(), tag(jsonSpace), show(jsonSpace.default));
  console.log("json is one object", json === esm.json, jsonSpace === esm.jsonSpace, jsonSpace.default === json, list === json.list);
  console.log("json required", show(require("./data/shared.json")), tag(require("./data/shared.json")), require("./data/shared.json") === cjs.held.json, require(hidden("./data/shared.json")) === cjs.held.json);
  console.log("json by import()", (await import("./data/shared.json")) === jsonSpace, (await import(hidden("./data/shared.json"))) === jsonSpace, (await import("./data/shared.json", { with: { type: "json" } })).default === json);
});
`,
  "others.test.js": `import { test } from "bun:test";
const hidden = text => JSON.parse(JSON.stringify(text));
const show = value => JSON.stringify(value);
const tag = value => Object.prototype.toString.call(value);
import text from "./data/shared.txt";
import toml, { a } from "./data/shared.toml";
import yaml from "./data/shared.yaml";
import { held as esm } from "./src/app.mjs";
import cjs from "./src/app.cjs";
test("text, toml, yaml", async () => {
  console.log("text", show(text), text === esm.text, show(require("./data/shared.txt")), show(cjs.held.text), show((await import("./data/shared.txt")).default));
  console.log("toml", show(toml), a, toml === esm.toml);
  console.log("yaml", show(yaml), yaml === esm.yaml);
});
`,
  "own.test.js": `import { test } from "bun:test";
const hidden = text => JSON.parse(JSON.stringify(text));
const show = value => JSON.stringify(value);
const tag = value => Object.prototype.toString.call(value);
import ownJson from "./data/own.json";
import ownText from "./data/own.txt";
import ownToml from "./data/own.toml";
test("files that only the test file names", async () => {
  console.log("own", show(ownJson), show(ownText), show(ownToml), show(require("./data/own.json")), show((await import("./data/own.toml")).default));
});
`,
  "types.test.js": `import { test } from "bun:test";
const hidden = text => JSON.parse(JSON.stringify(text));
const show = value => JSON.stringify(value);
const tag = value => Object.prototype.toString.call(value);
import typedText from "./data/typed.json" with { type: "text" };
import typedJson from "./data/typed.json";
import sharedAsText from "./data/shared.json" with { type: "text" };
import tomlAsText from "./data/shared.toml" with { type: "text" };
import { held as esm } from "./src/app.mjs";
test("data files under a type", async () => {
  console.log("types", show(typedText), show(typedJson), show(esm.typedText), show(sharedAsText), show(tomlAsText));
});
`,
  "types-by-import.test.js": `import { test } from "bun:test";
const hidden = text => JSON.parse(JSON.stringify(text));
const show = value => JSON.stringify(value);
const tag = value => Object.prototype.toString.call(value);
test("data files under a type, by import()", async () => {
  console.log("types by import()", show((await import("./data/shared.toml", { with: { type: "text" } })).default), show((await import(hidden("./data/typed.json"), { with: { type: "text" } })).default), show((await import("./src/both-ways.js", { with: { type: "text" } })).default));
});
`,
  "code-as-text.test.js": `import { test } from "bun:test";
const hidden = text => JSON.parse(JSON.stringify(text));
const show = value => JSON.stringify(value);
const tag = value => Object.prototype.toString.call(value);
import codeAsText from "./src/as-text.js" with { type: "text" };
test("code as text", async () => { console.log("code as text", show(codeAsText)); });
`,
  "code-both-ways.test.js": `import { test } from "bun:test";
const hidden = text => JSON.parse(JSON.stringify(text));
const show = value => JSON.stringify(value);
const tag = value => Object.prototype.toString.call(value);
import bothAsText from "./src/both-ways.js" with { type: "text" };
import { held as esm } from "./src/app.mjs";
test("code as text and as code", async () => { console.log("code both ways", show(bothAsText), esm.code); });
`,
  // A module of the project imports each of these files, and in the realms of the three test files below that module has not run: the file is loaded by itself.
  "data/alone-1.json": `{ "name": "alone 1", "list": [1] }`,
  "data/alone-2.json": `{ "name": "alone 2", "list": [2] }`,
  "data/alone-3.json": `{ "name": "alone 3", "list": [3] }`,
  "src/imports-them.mjs": `import one from "../data/alone-1.json";
import { name as two } from "../data/alone-2.json";
import * as three from "../data/alone-3.json";
export const names = [one.name, two, three.name];
`,
  "loads-the-importer.test.js": `import { test } from "bun:test";
test("the module that imports them", async () => { console.log("the importer", (await import("./src/imports-them.mjs")).names.join()); });
`,
  "alone-by-a-statement.test.js": `import { test } from "bun:test";
import one, { list } from "./data/alone-1.json";
import * as space from "./data/alone-1.json";
test("alone, by a statement", () => { console.log("alone, by a statement", JSON.stringify(one), JSON.stringify(list), Object.keys(space).join()); });
`,
  "alone-by-a-call.test.js": `import { test } from "bun:test";
test("alone, by import()", async () => { const space = await import("./data/alone-2.json"); console.log("alone, by import()", Object.keys(space).join(), JSON.stringify(space.default)); });
`,
  "alone-by-require.test.js": `import { test } from "bun:test";
test("alone, by require()", () => { const required = require("./data/alone-3.json"); console.log("alone, by require()", required.name, JSON.stringify(required.list)); });
`,
};
for (let i = 0; i < 16; i++)
  files[`more-${i}.test.js`] = `import { test } from "bun:test";\ntest("one of many, ${i}", () => {});`;

async function runTests(directory: string, words: string, ...flags: string[]) {
  // A small project is one program unless the word is there.
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { stdout: printed.sort(), results: results.sort(), exitCode };
}

for (const [form, words] of [
  ["over two layers", "TestRunLayers:2"],
  ["as one program", "TestRunLayers:0"],
]) {
  test(`a data file is one module for the test files and the project, ${form}`, async () => {
    using dir = tempDir("aot-data-files-in-layers", files);
    const plain = await runTests(String(dir), words);
    expect(plain.exitCode).toBe(0);
    expect(plain.results.length).toBe(27);
    expect(plain.stdout).toContain("json is one object true true true true");
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 120_000);
}
