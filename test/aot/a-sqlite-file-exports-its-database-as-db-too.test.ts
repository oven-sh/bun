import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A file imported with { type: "sqlite" } exports one Database as `default` and as `db`, beside `__esModule`. require() answers the object with the three names, and without the
// attribute it asks for another module than the statements do.
const files = {
  "data.sqlite": "",
  "main.mjs": `import theDefault, { db } from "./data.sqlite" with { type: "sqlite" };
import * as names from "./data.sqlite" with { type: "sqlite" };
import required from "./required.cjs";
import inAnotherFile from "./another.mjs";

console.log(typeof db, db.constructor.name, db === theDefault, db === inAnotherFile);
console.log(Object.keys(names).join(), names.db === db, names.default === db, names.__esModule);
const called = await import("./data.sqlite", { with: { type: "sqlite" } });
console.log(Object.keys(called).join(), called === names, called[["d", "b"].join("")] === db);
const asked = import.meta.require("./data.sqlite");
console.log(typeof asked, Object.keys(asked).join(), asked.db === db, asked.default === db);
console.log(required.keys, required.holds(db));
console.log(db.query("select 1 + 1 as two").get().two);
`,
  "required.cjs": `const asked = require("./data.sqlite");
exports.keys = Object.keys(asked).join();
exports.holds = db => [asked.db === db, asked.default === db, asked.__esModule].join();
`,
  "another.mjs": `import { db } from "./data.sqlite" with { type: "sqlite" };
export default db;
`,
};
const printed = [
  "object Database true true",
  "__esModule,db,default true true true",
  "__esModule,db,default true true",
  "object __esModule,db,default false false",
  "__esModule,db,default false,false,true",
  "2",
];

test("bun run", async () => {
  using directory = tempDir("sqlite-exports-plain", files);
  const { stdout, exitCode } = await run([bunExe(), "run", "./main.mjs"], String(directory), bunEnv);
  expect(stdout.trim().split("\n")).toEqual(printed);
  expect(exitCode).toBe(0);
});

test("an executable", async () => {
  using directory = tempDir("sqlite-exports-executable", files);
  const executable = join(String(directory), isWindows ? "program.exe" : "program.out");
  const build = [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable];
  expect(await run(build, String(directory), bunEnv)).toMatchObject({ exitCode: 0 });
  const { stdout, exitCode } = await run([executable], String(directory), bunEnv);
  expect(stdout.trim().split("\n")).toEqual(printed);
  expect(exitCode).toBe(0);
}, 240_000);

test("a test run", async () => {
  using directory = tempDir("sqlite-exports-test-run", {
    ...files,
    "main.test.mjs": `import { test } from "bun:test";\nimport "./main.mjs";\ntest("runs", () => {});\n`,
  });
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" };
  const { stdout } = await run([bunExe(), "test", "--aot", "./main.test.mjs"], String(directory), env);
  expect(stdout.split("\n").filter(line => line && !line.startsWith("bun test "))).toEqual(printed);
}, 240_000);

// Over layers the test file is a program of its own, and another.mjs lies in the program below it. Both import one file, so both hold one Database.
test("a test file and what it imports hold one database over layers", async () => {
  using directory = tempDir("sqlite-exports-layers", {
    "package.json": `{}`,
    "data.sqlite": "",
    "another.mjs": files["another.mjs"],
    "main.test.mjs": `import { test } from "bun:test";
import theDefault, { db } from "./data.sqlite" with { type: "sqlite" };
import inAnotherFile from "./another.mjs";
console.log(db === theDefault, db === inAnotherFile, db.constructor.name);
test("runs", () => {});
`,
  });
  const shown = async (flags: string[]) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" };
    const { stdout } = await run([bunExe(), "test", ...flags, "./main.test.mjs"], String(directory), env);
    return stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  };
  expect(await shown([])).toEqual(["true true Database"]);
  expect(await shown(["--aot"])).toEqual(["true true Database"]);
}, 240_000);
