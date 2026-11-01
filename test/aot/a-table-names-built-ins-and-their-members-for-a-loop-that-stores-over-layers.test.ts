// A suite keeps what it replaces in a table: `for (const [holder, key] of rows) globalThis[holder][key] = stub`, rows = [["console", "debug"], ["Error", "toString"]],
// written or parsed from a constant text, in the test file, beside it or in a package that is there to help the tests, with or without a helper that does the store.
// As one program the build follows the texts through the import and the helper. Over layers the run has to know which members its tests replace before the first build, from a look at each
// file by itself. That look took a built-in object beside a text for an object and the name of a member, and not a text that names the object:
// "TypeError: Cannot assign to console.debug because built-in objects are read-only in compiled code, and the build didn't see a test replace this one".
// And it did not look at a helper in a package, which writes what it is handed under names that only the run knows: `storeUnder(console, key, 0)`.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const storeUnder = `export function storeUnder(target, key, value) {\n  target[key] = value;\n}\n`;
const defineUnder = `export function defineUnder(target, key, value) {\n  Object.defineProperty(target, key, { value, writable: true, configurable: true });\n}\n`;
const rowsParsed = `export const rows = JSON.parse('[["console","debug"],["console","table"]]');\n`;
const rowsWritten = `export const rows = [["console", "debug"], ["console", "table"]];\n`;
const keysParsed = `export const keys = JSON.parse('["debug","table"]');\n`;
const keysWritten = `export const keys = ["debug", "table"];\n`;
const holdersParsed = `export const holders = JSON.parse('["console"]');\n`;

type Way = { helpers: string; liesIn: "a package" | "a file beside the test"; body: string; asOneProgram?: false };
const ways: Record<string, Way> = {
  "rows parsed in a package, whose helper stores": {
    helpers: storeUnder + rowsParsed,
    liesIn: "a package",
    body: `for (const [holder, key] of helpers.rows) helpers.storeUnder(globalThis[holder], key, 0);`,
  },
  // TODO: as one program the definition is refused (row 4155).
  "rows parsed in a package, whose helper defines": {
    helpers: defineUnder + rowsParsed,
    liesIn: "a package",
    body: `for (const [holder, key] of helpers.rows) helpers.defineUnder(globalThis[holder], key, 0);`,
    asOneProgram: false,
  },
  "rows parsed in a package, stored in the test file": {
    helpers: rowsParsed,
    liesIn: "a package",
    body: `for (const [holder, key] of helpers.rows) globalThis[holder][key] = 0;`,
  },
  "rows parsed beside the test, where the helper stores": {
    helpers: storeUnder + rowsParsed,
    liesIn: "a file beside the test",
    body: `for (const [holder, key] of helpers.rows) helpers.storeUnder(globalThis[holder], key, 0);`,
  },
  "rows written beside the test, stored in the test file": {
    helpers: rowsWritten,
    liesIn: "a file beside the test",
    body: `for (const [holder, key] of helpers.rows) globalThis[holder][key] = 0;`,
  },
  "the holders parsed in a package, the keys spelled at the call": {
    helpers: storeUnder + holdersParsed,
    liesIn: "a package",
    body: `for (const holder of helpers.holders) { helpers.storeUnder(globalThis[holder], "debug", 0); helpers.storeUnder(globalThis[holder], "table", 0); }`,
  },
  "the keys parsed in a package, whose helper is handed the object": {
    helpers: storeUnder + keysParsed,
    liesIn: "a package",
    body: `for (const key of helpers.keys) helpers.storeUnder(console, key, 0);`,
  },
  "the keys written in a package, whose helper is handed the object": {
    helpers: storeUnder + keysWritten,
    liesIn: "a package",
    body: `for (const key of helpers.keys) helpers.storeUnder(console, key, 0);`,
  },
};

async function linesOf(way: Way, flags: string[]) {
  const names = [...way.helpers.matchAll(/export (?:function|const) (\w+)/g)].map(match => match[1]);
  const body = way.body.replaceAll("helpers.", "");
  using dir = tempDir("aot-table-names-built-ins", {
    "package.json": `{ "name": "p", "type": "module" }`,
    ...(way.liesIn === "a package"
      ? {
          "node_modules/parts/package.json": `{ "name": "parts", "version": "1.0.0", "type": "module" }`,
          "node_modules/parts/helpers.js": way.helpers,
        }
      : { "helpers.js": way.helpers }),
    "main.test.js": `
      import { ${names.join(", ")} } from "${way.liesIn === "a package" ? "parts/helpers.js" : "./helpers.js"}";
      import { test } from "bun:test";
      const say = console.error.bind(console);
      ${body}
      say("OUT", typeof console.debug, typeof console.table, typeof console.log);
      test("ran to its end", () => {});`,
  });
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return {
    lines: stderr
      .split("\n")
      .filter(line => /^(OUT|error|TypeError)/.test(line))
      .sort(),
    exitCode,
  };
}

test.concurrent.each(Object.entries(ways))(
  "%s",
  async (_, way) => {
    const plain = await linesOf(way, []);
    expect(plain).toEqual({ lines: ["OUT number number function"], exitCode: 0 });
    if (way.asOneProgram !== false) expect(await linesOf(way, ["--aot"])).toEqual(plain);
    // More source than fits the memory as one program: the run is built in layers.
    expect(await linesOf(way, ["--aot", "--parallel=2", "--aot-memory-limit=1KB"])).toEqual(plain);
  },
  240_000,
);

// The prototypes of classes, found under the names of the classes: the table lies behind a file that exports it again.
test("a table of classes and methods of their prototypes, exported again by a second file", async () => {
  const files = {
    "package.json": `{ "name": "p", "type": "module" }`,
    "table.js": `export const table = [["Error", "toString"], ["WeakRef", "deref"], ["FinalizationRegistry", "register"]];`,
    "barrel.js": `export { table } from "./table.js";`,
    "main.test.js": `
      import { table } from "./barrel.js";
      import { test } from "bun:test";
      for (const [holder, name] of table) {
        const object = globalThis[holder].prototype;
        const was = object[name];
        const other = function other() {};
        object[name] = other;
        console.error("OUT", holder, name, object[name] === other);
        object[name] = was;
      }
      test("ran to its end", () => {});`,
  };
  const answers = [];
  for (const flags of [[], ["--aot"], ["--aot", "--parallel=2", "--aot-memory-limit=1KB"]]) {
    using dir = tempDir("aot-table-names-classes", files);
    await using run = Bun.spawn({
      cmd: [bunExe(), "test", ...flags],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
    answers.push({ lines: stderr.split("\n").filter(line => /^(OUT|error|TypeError)/.test(line)), exitCode });
  }
  expect(answers[0]).toEqual({
    lines: ["OUT Error toString true", "OUT WeakRef deref true", "OUT FinalizationRegistry register true"],
    exitCode: 0,
  });
  expect(answers[1]).toEqual(answers[0]);
  expect(answers[2]).toEqual(answers[0]);
}, 240_000);
