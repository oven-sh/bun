import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

raiseDefaultTimeout(240_000);

// module-alias and tsconfig-paths store `Module._resolveFilename`, require-in-the-middle stores `Module.prototype.require`. From then on
// plain Bun asks them at every `require`, also where the name is a constant that the build has bound to a file of the program.
const head = `
const { test } = require("bun:test");
const Module = require("node:module");
const path = require("node:path");
const say = (...words) => console.error("SEEN " + words.join(" "));
const short = value => String(value).replace(/^.*[\\\\/]/, "");
`;
const files = {
  "package.json": `{ "name": "loader-functions-of-a-test" }`,
  ...Object.fromEntries(
    ["a", "b", "c", "d", "h", "i", "j"].map(name => [`src/late-${name}.js`, `exports.name = "late-${name}";\n`]),
  ),
  "src/typed.ts": `export const name: string = "typed";\n`,
  "src/user.js": `
exports.load = () => require("./late-h.js").name;
exports.loadOther = () => require("./late-i.js").name;
exports.viaAlias = () => require("@app/late-d").name;
exports.http = () => Object.keys(require("node:http")).includes("patched") + " " + Object.keys(require("http")).includes("patched");
`,
  "resolver.test.cjs": `${head}
test("a resolver", () => {
  const seen = [];
  const original = Module._resolveFilename;
  say("before the store:", require("./src/late-j.js").name);
  Module._resolveFilename = function (request, ...rest) { seen.push(short(request)); return original.call(this, request, ...rest); };
  say("first require:", require("./src/late-a.js").name, seen.join()); seen.length = 0;
  say("again:", require("./src/late-a.js").name, seen.join()); seen.length = 0;
  say("required before the store:", require("./src/late-j.js").name, seen.join()); seen.length = 0;
  const user = require("./src/user.js"); seen.length = 0;
  say("in a file of the project:", user.load(), seen.join()); seen.length = 0;
  say("an ES module of the project:", require("./src/typed.ts").name, seen.join()); seen.length = 0;
  say("resolve:", short(require.resolve("./src/late-a.js")), seen.join()); seen.length = 0;
  say("a library module:", typeof require("node:os").hostname, seen.join()); seen.length = 0;
  Module._resolveFilename = function (request, ...rest) { return original.call(this, request.replace("late-b", "late-c").replace("late-i", "late-c"), ...rest); };
  say("sent elsewhere:", require("./src/late-b.js").name, user.loadOther());
  Module._resolveFilename = original;
  say("restored:", require("./src/late-b.js").name, seen.join());
});
`,
  "alias.test.cjs": `${head}
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return original.call(this, request.startsWith("@app/") ? path.join(__dirname, "src", request.slice(5) + ".js") : request, ...rest); };
test("names that only the program's resolver knows", () => {
  say("in the test file:", require("@app/late-a").name);
  say("in a file of the project:", require("./src/user.js").viaAlias());
  say("resolve:", path.basename(require.resolve("@app/late-b")));
});
`,
  "wrapper.test.cjs": `${head}
test("a function round every require", () => {
  const seen = [];
  const original = Module.prototype.require;
  Module.prototype.require = function (request) { seen.push(short(request)); return original.call(this, request); };
  say("first require:", require("./src/late-a.js").name, seen.join()); seen.length = 0;
  say("again:", require("./src/late-a.js").name, seen.join()); seen.length = 0;
  const user = require("./src/user.js"); seen.length = 0;
  say("in a file of the project:", user.load(), seen.join()); seen.length = 0;
  say("an ES module of the project:", require("./src/typed.ts").name, seen.join()); seen.length = 0;
  Module.prototype.require = function (id) {
    const exports = original.apply(this, arguments);
    return id === "http" || id === "node:http" ? { ...exports, patched: true } : id.endsWith("late-b.js") ? { name: "wrapped " + exports.name } : exports;
  };
  say("a library module:", Object.keys(require("http")).includes("patched"), Object.keys(require("node:http")).includes("patched"), user.http());
  say("a file:", require("./src/late-b.js").name);
  Module.prototype.require = original;
  say("restored:", require("./src/late-b.js").name, seen.join());
});
`,
  "setup.cjs": `
const Module = require("node:module");
const path = require("node:path");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return original.call(this, request.startsWith("@app/") ? path.join(__dirname, "src", request.slice(5) + ".js") : request, ...rest); };
`,
  "behind-a-preload.test.cjs": `${head}
test("a resolver that a preload stores", () => {
  if (Module._resolveFilename.name !== "") return;
  say("in the test file:", require("@app/late-a").name);
  say("in a file of the project:", require("./src/user.js").viaAlias());
});
`,
};

const seenWith = async (dir: string, env: Record<string, string>, ...flags: string[]) => {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], dir, { ...bunEnv, ...env });
  return { seen: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
};

test.each([
  ["resolver.test.cjs", 10, []],
  ["alias.test.cjs", 3, []],
  ["wrapper.test.cjs", 7, []],
  ["behind-a-preload.test.cjs", 2, ["--preload", "./setup.cjs"]],
] as const)("%s prints what it prints under plain bun test", async (file, lines, flags) => {
  using dir = tempDir("aot-loader-functions-of-a-test", files);
  const [plain, oneProgram, layers] = await Promise.all([
    seenWith(String(dir), {}, ...flags, `./${file}`),
    seenWith(String(dir), {}, "--aot", ...flags, `./${file}`),
    seenWith(
      String(dir),
      { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" },
      "--aot",
      "--parallel=2",
      ...flags,
      `./${file}`,
    ),
  ]);
  expect({ lines: plain.seen.length, exitCode: plain.exitCode }).toEqual({ lines, exitCode: 0 });
  expect(oneProgram).toEqual(plain);
  expect(layers).toEqual(plain);
});
