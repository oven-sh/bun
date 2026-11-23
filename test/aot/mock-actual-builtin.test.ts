// jest.requireActual("node:path"), vi.importActual() and the parameter of a mock's factory answer with the built-in module's own object. The call is one of a
// function of the test runner, so the build took its answer for something it had never let out of its sight, and compiled code read the module's members without
// a test: `jest.mock("node:path", () => ({ ...jest.requireActual("node:path"), basename: .. }))` ended the run with "StoreOfOtherType .. ImpossibleMutation".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const reader = (module: string, names: string[]) => `const it = require("${module}");
exports.read = () => [${names.map(name => `it.${name}`).join(", ")}].map(member => (typeof member === "function" ? member.marker || "real" : String(member))).join();
`;
const stored = `Object.assign(() => "mine", { marker: "stored" })`;

const files = {
  "package.json": `{ "name": "mock-actual-builtin" }`,
  "path.cjs": reader("node:path", ["basename", "join", "sep"]),
  "url.cjs": reader("node:url", ["parse", "format"]),
  "child.cjs": reader("node:child_process", ["spawn", "execSync"]),

  "idiom.test.mjs": `import { jest, test } from "bun:test";
jest.mock("node:path", () => ({ ...jest.requireActual("node:path"), basename: () => "mocked" }));
test("Jest's partial mock of a built-in", () => {
  const path = require("node:path");
  console.log("OUT", path.basename("/a/b"), path.join("a", "b"), typeof path.posix);
});`,
  "spread.test.mjs": `import { jest, test } from "bun:test";
import reader from "./path.cjs";
test("a member laid over a spread", () => {
  const actual = jest.requireActual("node:path");
  const forms = [{ ...actual, basename: ${stored} }, { ...actual, sep: 5 }, { ...actual, basename: actual.dirname }, Object.assign({}, actual, { join: ${stored} })];
  const later = { ...actual };
  later.basename = ${stored};
  console.log("OUT", forms.map(form => [form.basename("/a/b"), form.sep, form.join("a", "b")].join()).join(" | "), later.basename(), reader.read());
});`,
  "store.test.mjs": `import { jest, test } from "bun:test";
import reader from "./path.cjs";
test("a store into the module's own object", () => {
  const actual = jest.requireActual("node:path");
  const { basename } = actual;
  console.log("OUT", reader.read());
  actual.basename = ${stored};
  console.log("OUT", reader.read(), require("node:path").basename("/a/b"));
  actual.basename = basename;
  console.log("OUT", reader.read());
});`,
  "imported.test.mjs": `import { test, vi } from "bun:test";
import reader from "./url.cjs";
test("vi.importActual()", async () => {
  const actual = await vi.importActual("node:url");
  const { parse } = actual.default;
  console.log("OUT", typeof { ...actual, parse: 5 }.parse, typeof { ...actual.default, parse: 5 }.format, reader.read());
  actual.default.parse = ${stored};
  console.log("OUT", reader.read());
  actual.default.parse = parse;
});`,
  "parameter.test.mjs": `import { test, vi } from "bun:test";
import reader from "./child.cjs";
import { execSync, spawn } from "node:child_process";
vi.mock("node:child_process", async importOriginal => {
  const original = (globalThis.original = (await importOriginal()).default);
  return { ...original, spawn: ${stored} };
});
test("the parameter of a factory", () => {
  const { original } = globalThis;
  console.log("OUT", spawn(), typeof execSync, typeof original.spawn, reader.read());
  const kept = original.execSync;
  original.execSync = ${stored};
  console.log("OUT", original.execSync(), reader.read());
  original.execSync = kept;
});`,
  "setters.test.mjs": `import { jest, test } from "bun:test";
test("every member is stored back, the ones with a setter too", () => {
  const modules = [jest.requireActual("node:util"), jest.requireActual("node:timers"), jest.requireActual("node:net"), jest.requireActual("node:http")];
  for (const module of modules) Object.assign(module, { ...module });
  console.log("OUT", modules.map(module => Object.keys(module).length > 3).join(), require("node:util").format("%s", 1));
});`,
  "setters.test.cjs": `test("a store under each key of the module", () => {
  const util = jest.requireActual("node:util");
  const kept = { ...util };
  for (const key of Object.keys(util)) util[key] = ${stored};
  console.log("OUT", util.inspect.marker, util.formatWithOptions.marker);
  for (const key of Object.keys(kept)) util[key] = kept[key];
  console.log("OUT", require("node:util").format("%s", 1));
});`,
  "global.test.ts": `import reader from "./path.cjs";
test("the global jest in a TypeScript file", () => {
  const made = { ...jest.requireActual("node:path"), basename: ${stored} };
  console.log("OUT", made.basename("/a/b"), (reader as any).read());
});`,
  "commonjs.test.cjs": `const reader = require("./path.cjs");
jest.mock("node:path", () => ({ ...jest.requireActual("node:path"), basename: () => "mocked" }));
test("a CommonJS test file", () => {
  console.log("OUT", require("node:path").basename("/a/b"), typeof require("node:path").join);
});`,
  "computed.test.mjs": `import { jest, test } from "bun:test";
import reader from "./path.cjs";
test("a name that the build can't read", () => {
  const made = { ...jest.requireActual(["node", "path"].join(":")), basename: ${stored} };
  console.log("OUT", made.basename("/a/b"), reader.read());
});`,
};

async function run(dir: string, file: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "./" + file],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

const pins = {
  "idiom.test.mjs": ["OUT mocked a/b object"],
  "store.test.mjs": ["OUT real,real,/", "OUT stored,real,/ mine", "OUT real,real,/"],
};

test.concurrent.each(Object.keys(files).filter(name => name.includes(".test.")))(
  "%s",
  async file => {
    using folder = tempDir("aot-mock-actual-builtin", files);
    const dir = String(folder);
    const plain = await run(dir, file, []);
    expect(plain.exitCode).toBe(0);
    if (file in pins) expect(plain.lines).toEqual(pins[file as keyof typeof pins]);
    expect(await run(dir, file, ["--aot"], "TestRunLayers:0")).toEqual(plain);
  },
  240_000,
);
