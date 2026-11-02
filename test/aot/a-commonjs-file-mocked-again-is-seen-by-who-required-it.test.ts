import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const target = `exports.v = "real"; exports.w = "real w";\n`;
const user = (name: string) => `
const T = require("./target-${name}.cjs");
const { v } = T;
exports.read = () => T.v;
exports.early = () => v;
exports.held = () => T;
exports.keys = () => Object.keys(T).join();
`;

// Whoever required the file behind the first mock holds an object. A later mock replaces the values of the names that the object has:
// it adds none, and a name that it leaves out keeps its value. A later require() answers another object, with the names of the later mock.
const testFile = `
import { test, mock } from "bun:test";
const say = (...words) => console.error("SEEN " + words.join(" "));
test("three mocks of one file, required behind the first", () => {
  mock.module("./src/target-a.cjs", () => ({ v: "first" }));
  const user = require("./src/user-a.cjs");
  say("a1", user.read(), user.early(), user.keys());
  mock.module("./src/target-a.cjs", () => ({ v: "second" }));
  say("a2", user.read(), user.early(), user.keys(), require("./src/target-a.cjs") === user.held(), require("./src/target-a.cjs").v);
  mock.module("./src/target-a.cjs", () => ({ v: "third" }));
  say("a3", user.read(), user.early(), user.keys(), require("./src/target-a.cjs") === user.held(), require("./src/target-a.cjs").v);
});
test("required and imported behind the first", async () => {
  mock.module("./src/target-b.cjs", () => ({ v: "first" }));
  const user = require("./src/user-b.cjs");
  const importer = await import("./src/importer-b.mjs");
  say("b1", user.read(), importer.read(), importer.keys());
  mock.module("./src/target-b.cjs", () => ({ v: "second" }));
  say("b2", user.read(), importer.read(), importer.keys());
});
test("the second mock names more", () => {
  mock.module("./src/target-c.cjs", () => ({ v: "first" }));
  const user = require("./src/user-c.cjs");
  mock.module("./src/target-c.cjs", () => ({ v: "second", w: "second w" }));
  say("c2", user.read(), user.keys(), user.held().w, require("./src/target-c.cjs") === user.held(), Object.keys(require("./src/target-c.cjs")).join());
});
test("the second mock names less", () => {
  mock.module("./src/target-d.cjs", () => ({ v: "first", w: "first w" }));
  const user = require("./src/user-d.cjs");
  mock.module("./src/target-d.cjs", () => ({ v: "second" }));
  say("d2", user.read(), user.keys(), user.held().w, require("./src/target-d.cjs") === user.held(), Object.keys(require("./src/target-d.cjs")).join());
});
`;

test("a later mock of a CommonJS file reaches the object that an earlier require() answered", async () => {
  using dir = tempDir("aot-commonjs-file-mocked-again", {
    "package.json": `{ "name": "commonjs-file-mocked-again" }`,
    ...Object.fromEntries(
      ["a", "b", "c", "d"].flatMap(name => [
        [`src/target-${name}.cjs`, target],
        [`src/user-${name}.cjs`, user(name)],
      ]),
    ),
    "src/importer-b.mjs": `
import { v } from "./target-b.cjs";
import * as all from "./target-b.cjs";
export const read = () => v;
export const keys = () => Object.keys(all).join();
`,
    "again.test.js": testFile,
  });
  const seenWith = async (env: Record<string, string>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, ...env });
    return { seen: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
  };
  const [plain, oneProgram, layers] = await Promise.all([
    seenWith({}),
    seenWith({}, "--aot"),
    seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" }, "--aot", "--parallel=2"),
  ]);
  expect(plain).toEqual({
    seen: [
      "SEEN a1 first first v",
      "SEEN a2 second first v false second",
      "SEEN a3 third first v false third",
      "SEEN b1 first first v",
      "SEEN b2 second second v",
      "SEEN c2 second v  false v,w",
      "SEEN d2 second v,w first w false v",
    ],
    exitCode: 0,
  });
  expect(oneProgram).toEqual(plain);
  expect(layers).toEqual(plain);
});
