import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const attempt = (statement: string) =>
  `try {\n  ${statement};\n  console.log(new Date(0).getTime());\n} catch (error) {\n  console.log(error.constructor.name);\n}\n`;

const attemptToAdd = (statement: string) =>
  `try {\n  ${statement};\n  console.log(new Response("").upper());\n} catch (error) {\n  console.log(error.constructor.name);\n}\n`;

const attemptToAddToFunctions = (statement: string) =>
  `try {\n  ${statement};\n  console.log((() => 1).upper());\n} catch (error) {\n  console.log(error.constructor.name);\n}\n`;

type Program = { source: string; files?: Record<string, string>; code?: string; warnings: string[]; stdout: string };
const programs: Record<string, Program> = {
  "a descriptor that gets its value behind the literal": {
    source:
      `const put = (object, key, value) => {\n  const descriptor = { configurable: true };\n  descriptor.value = value;\n  Object.defineProperty(object, key, descriptor);\n};\n` +
      attempt(`put(Date.prototype, "getTime", () => 7)`),
    warnings: ["main.mjs:4:10"],
    stdout: "TypeError\n",
  },
  "a descriptor that gets its value or its getter in a branch": {
    source:
      `const put = (object, key, value) => {\n  const descriptor = { configurable: true };\n  if (value.length) descriptor.get = value;\n  else descriptor.value = value;\n  Object.defineProperty(object, key, descriptor);\n};\n` +
      attempt(`put(Date.prototype, "getTime", () => 7)`),
    warnings: ["main.mjs:5:10"],
    stdout: "TypeError\n",
  },
  "a descriptor without a value": {
    source: attempt(`Object.defineProperty(Date.prototype, "getTime", { enumerable: false })`),
    warnings: [],
    stdout: "0\n",
  },
  "a descriptor whose value was deleted": {
    source:
      `const descriptor = { value: 1 };\ndelete descriptor.value;\n` +
      attempt(`Object.defineProperty(Date.prototype, "getTime", descriptor)`),
    warnings: [],
    stdout: "0\n",
  },
  "Object.assign()": {
    source: attempt(`Object.assign(Date.prototype, { getTime: () => 7 })`),
    warnings: ["main.mjs:2:10"],
    stdout: "TypeError\n",
  },
  "Object.assign() of other names": {
    source: attempt(`Object.assign(Date.prototype, { getSeven: () => 7 })`),
    warnings: [],
    stdout: "0\n",
  },
  "Object.defineProperties()": {
    source: attempt(`Object.defineProperties(Date.prototype, { getTime: { value: () => 7 } })`),
    warnings: ["main.mjs:2:10"],
    stdout: "TypeError\n",
  },
  "Object.assign() of the member itself": {
    source: attempt(`Object.assign(Date.prototype, { getTime: Date.prototype.getTime })`),
    warnings: [],
    stdout: "0\n",
  },
  "Object.defineProperties() without a value": {
    source: attempt(`Object.defineProperties(Date.prototype, { getTime: { enumerable: false } })`),
    warnings: [],
    stdout: "0\n",
  },
  "the member's own descriptor": {
    source: attempt(
      `Object.defineProperty(Date.prototype, "getTime", Object.getOwnPropertyDescriptor(Date.prototype, "getTime"))`,
    ),
    warnings: [],
    stdout: "0\n",
  },
  "Object.assign() outside a function is no error": {
    source: `Object.assign(Date.prototype, { getTime: [Date.prototype.getTime, () => 7][0] });\nconsole.log(new Date(0).getTime());\n`,
    warnings: ["main.mjs:1:8"],
    stdout: "0\n",
  },
  "Object.assign() of what a function returns": {
    source: `const make = () => ({ getTime: () => 7 });\n` + attempt(`Object.assign(Date.prototype, make())`),
    warnings: ["main.mjs:3:10"],
    stdout: "TypeError\n",
  },
  "Object.assign() of a copy": {
    source: `const methods = { getTime: () => 7 };\n` + attempt(`Object.assign(Date.prototype, { ...methods })`),
    warnings: ["main.mjs:3:10"],
    stdout: "TypeError\n",
  },
  "Object.defineProperties() of another object's descriptors": {
    source: attempt(`Object.defineProperties(Date.prototype, Object.getOwnPropertyDescriptors({ getTime: () => 7 }))`),
    warnings: ["main.mjs:2:10"],
    stdout: "TypeError\n",
  },
  "another object's descriptor": {
    source: attempt(
      `Object.defineProperty(Date.prototype, "getTime", Object.getOwnPropertyDescriptor({ getTime: () => 7 }, "getTime"))`,
    ),
    warnings: ["main.mjs:2:10"],
    stdout: "TypeError\n",
  },
  "a getter in place of a built-in getter": {
    source: attempt(`Object.defineProperty(Array, Symbol.species, { get: () => Object })`),
    warnings: ["main.mjs:2:10"],
    stdout: "TypeError\n",
  },
  "a name out of Object.entries()": {
    source: attempt(`for (const [name, method] of Object.entries({ getTime: () => 7 })) Date.prototype[name] = method`),
    warnings: ["main.mjs:2:75"],
    stdout: "TypeError\n",
  },
  "a name put together at run time": {
    source: attempt(`Date.prototype[["get", "Time"].join("")] = () => 7`),
    warnings: ["main.mjs:2:8"],
    stdout: "TypeError\n",
  },
  "a name that nobody reads on an object of the program": {
    source: attempt(`const own = {};\n  own[["get", "Time"].join("")] = () => 7`),
    warnings: [],
    stdout: "0\n",
  },
  "a name that the object lacks is let in out of a literal": {
    source: attemptToAdd(`Object.assign(Response.prototype, { upper: () => "up" })`),
    warnings: [],
    stdout: "up\n",
  },
  "a name that the object lacks is let in out of a call": {
    source: `const make = () => ({ upper: () => "up" });\n` + attemptToAdd(`Object.assign(Response.prototype, make())`),
    warnings: [],
    stdout: "up\n",
  },
  "a name that the object lacks is let in out of an instance": {
    source:
      `class Mixin {\n  upper = () => "up";\n}\n` + attemptToAdd(`Object.assign(Response.prototype, new Mixin())`),
    warnings: [],
    stdout: "up\n",
  },
  "a name that the object lacks is let in out of a frozen constant": {
    source:
      `const helpers = Object.freeze({ upper: () => "up" });\n` +
      attemptToAdd(`Object.assign(Response.prototype, helpers)`),
    warnings: [],
    stdout: "up\n",
  },
  "a name that the object lacks is let in out of descriptors that a call makes": {
    source:
      `const make = () => ({ upper: { value: () => "up" } });\n` +
      attemptToAdd(`Object.defineProperties(Response.prototype, make())`),
    warnings: [],
    stdout: "up\n",
  },
  // The build reads the literal that the file exports, so it knows the name as it knows one of a literal beside the call.
  "a name that the object lacks, out of another file": {
    source: attemptToAdd(`Object.assign(Response.prototype, require("./helpers.cjs"))`),
    files: { "helpers.cjs": `module.exports = { upper: () => "up" };\n` },
    warnings: [],
    stdout: "up\n",
  },
  "a name that the object lacks, stored behind the literal": {
    source:
      `const helpers = {};\nhelpers.upper = () => "up";\n` + attemptToAdd(`Object.assign(Response.prototype, helpers)`),
    warnings: [],
    stdout: "up\n",
  },
  "a name that Function.prototype lacks, out of another file": {
    source: attemptToAddToFunctions(`Object.assign(Function.prototype, require("./helpers.cjs"))`),
    files: { "helpers.cjs": `module.exports = { upper: () => "up" };\n` },
    warnings: ["main.mjs:2:10"],
    stdout: "TypeError\n",
  },
  "a name that Function.prototype lacks, stored behind the literal": {
    source:
      `const helpers = {};\nhelpers.upper = () => "up";\n` +
      attemptToAddToFunctions(`Object.assign(Function.prototype, helpers)`),
    warnings: ["main.mjs:4:10"],
    stdout: "TypeError\n",
  },
  "mock.method() of node:test": {
    // The build does not follow the object into Bun's own code, which makes the write: docs/compiler/compatibility.mdx, "Built-in objects are read-only".
    source: `import { mock } from "node:test";\n` + attempt(`mock.method(Date.prototype, "getTime", () => 7)`),
    warnings: [],
    stdout: "TypeError\n",
  },
  "the functions that the loader asks are stored": {
    source: `import Module from "node:module";\nconst { require: load, } = Module.prototype;\nModule.prototype.require = function (name) {\n  return load.call(this, name);\n};\nconst same = Module;\nsame._resolveFilename = Module._resolveFilename;\nconsole.log("stored");\n`,
    code: "TS100080",
    warnings: ["main.mjs:3:1", "main.mjs:7:1"],
    stdout: "stored\n",
  },
  "a module is taken out of require.cache": {
    source: `const first = require("./part.cjs");\ndelete require.cache[require.resolve("./part.cjs")];\nconsole.log(require("./part.cjs") === first);\n`,
    files: { "part.cjs": "exports.a = 1;\n" },
    code: "TS100091",
    warnings: ["main.mjs:2:8"],
    stdout: "true\n",
  },
  "a module is taken out of require.cache where nothing comes": {
    source: `function nobodyCalls() {\n  delete require.cache[require.resolve("./part.cjs")];\n}\nconsole.log(require("./part.cjs").a);\n`,
    files: { "part.cjs": "exports.a = 1;\n" },
    code: "TS100091",
    warnings: [],
    stdout: "1\n",
  },
  "an entry is stored in require.cache under the path of a compiled file": {
    source: `require.cache[require.resolve("./part.cjs")] = { exports: { a: 2 } };\nconsole.log(require("./part.cjs").a);\n`,
    files: { "part.cjs": "exports.a = 1;\n" },
    code: "TS100092",
    warnings: ["main.mjs:1:1"],
    stdout: "1\n",
  },
  "an entry is stored in require.cache where nothing comes, and under a path outside": {
    source: `function nobodyCalls() {\n  require.cache[require.resolve("./part.cjs")] = { exports: { a: 2 } };\n}\nrequire.cache["/made-up/outside.cjs"] = { exports: { a: 3 } };\nconsole.log(require("./part.cjs").a);\n`,
    files: { "part.cjs": "exports.a = 1;\n" },
    code: "TS100092",
    warnings: [],
    stdout: "1\n",
  },
  "require.cache is handed to a function of another file that deletes from it": {
    source: `require("./part.cjs");\nrequire("./clear.cjs")(require.cache, require.resolve("./part.cjs"));\nconsole.log(require("./part.cjs").a);\n`,
    files: {
      "part.cjs": "exports.a = 1;\n",
      "clear.cjs": "module.exports = (table, key) => {\n  delete table[key];\n};\n",
    },
    code: "TS100093",
    warnings: ["main.mjs:2:24"],
    stdout: "1\n",
  },
  "require is handed to a function of another file that deletes from its cache": {
    source: `const clear = require("./clear.cjs");\nrequire("./part.cjs");\nclear(require, "./part.cjs");\nconsole.log(require("./part.cjs").a);\n`,
    files: {
      "part.cjs": "exports.a = 1;\n",
      "clear.cjs": "module.exports = (ask, path) => {\n  delete ask.cache[ask.resolve(path)];\n};\n",
    },
    code: "TS100093",
    warnings: ["main.mjs:3:7"],
    stdout: "1\n",
  },
  "require is handed to a function of the same file that does more than call it": {
    source: `function clear(ask) {\n  delete ask.cache[ask.resolve("./part.cjs")];\n}\nrequire("./part.cjs");\nclear(require);\nconsole.log(require("./part.cjs").a);\n`,
    files: { "part.cjs": "exports.a = 1;\n" },
    code: "TS100093",
    warnings: ["main.mjs:5:7"],
    stdout: "1\n",
  },
  "require.cache is stored on the global object and in an object": {
    source: `globalThis.table = require.cache;\nconst held = { table: require.cache };\nconsole.log(typeof held.table, require("./part.cjs").a);\n`,
    files: { "part.cjs": "exports.a = 1;\n" },
    code: "TS100093",
    warnings: ["main.mjs:1:20", "main.mjs:2:23"],
    stdout: "object 1\n",
  },
  "Module is handed to a function that reads its cache": {
    source: `import Module from "node:module";\nfunction lay(holder) {\n  return Object.keys(holder._cache).length >= 0;\n}\nconsole.log(lay(Module), require("./part.cjs").a);\n`,
    files: { "part.cjs": "exports.a = 1;\n" },
    code: "TS100093",
    warnings: ["main.mjs:5:17"],
    stdout: "true 1\n",
  },
  "require is handed to functions that the build finds and that only call it": {
    source: `(function (factory) {\n  console.log(factory(require, {}));\n})(function (require, exports) {\n  return require("./part.cjs").a;\n});\nfunction load(ask) {\n  return ask("./part.cjs").a;\n}\nconst loadToo = ask => ask("./part.cjs").a;\nconsole.log(load(require), loadToo(require), (ask => ask("./part.cjs").a)(require));\n`,
    files: { "part.cjs": "exports.a = 1;\n" },
    code: "TS100093",
    warnings: [],
    stdout: "1\n1 1 1\n",
  },
  "require is handed to a built-in function, listed, and comes out of the helper that bundlers write": {
    source: `var __require = /* @__PURE__ */ (x =>\n  typeof require !== "undefined"\n    ? require\n    : typeof Proxy !== "undefined"\n      ? new Proxy(x, { get: (a, b) => (typeof require !== "undefined" ? require : a)[b] })\n      : x)(function (x) {\n  if (typeof require !== "undefined") return require.apply(this, arguments);\n  throw Error("no require: " + x);\n});\nconst list = [require];\nconsole.log(String(require).length > 0, list.length, __require("./part.cjs").a);\n`,
    files: { "part.cjs": "exports.a = 1;\n" },
    code: "TS100093",
    warnings: [],
    stdout: "true 1 1\n",
  },
  "require.cache and require are handed on where nothing comes, and only looked at": {
    source: `function nobodyCalls(lay) {\n  lay(require.cache);\n  lay(require);\n}\nconsole.log(typeof require, typeof require.cache, Object.keys(require.cache).length >= 0, require("./part.cjs").a);\n`,
    files: { "part.cjs": "exports.a = 1;\n" },
    code: "TS100093",
    warnings: [],
    stdout: "function object true 1\n",
  },
  "the functions that the loader asks are read, and stored where nothing comes": {
    source: `import Module from "node:module";\nfunction nobodyCalls() {\n  Module.prototype.require = () => {};\n}\nconsole.log(typeof Module.prototype.require, typeof Module._resolveFilename);\n`,
    code: "TS100080",
    warnings: [],
    stdout: "function function\n",
  },
};

for (const [name, { source, files, code = "TS100014", warnings, stdout }] of Object.entries(programs)) {
  test(`${code}: ${name}`, async () => {
    using dir = tempDir("aot-locked-built-in-write-warnings", { "main.mjs": source, ...files });
    const cwd = String(dir);
    const executable = join(cwd, "main");
    const built = await run([bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable], cwd, {
      ...bunEnv,
      NO_COLOR: "1",
    });
    const said = built.stdout + built.stderr;
    expect({
      warnings: [...said.matchAll(new RegExp(code + String.raw`: [^\n]*\n\s+at \S*?(main\.mjs:\d+:\d+)`, "g"))].map(
        match => match[1],
      ),
      exitCode: built.exitCode,
    }).toEqual({ warnings, exitCode: 0 });
    expect((await run([executable], cwd)).stdout).toBe(stdout);
  }, 240_000);
}

test("a test adds a name through Object.assign()", async () => {
  using dir = tempDir("aot-locked-built-in-write-warnings", {
    "main.test.mjs": `import { expect, test } from "bun:test";\nconst make = () => ({ upper: () => "up" });\ntest("t", () => {\n  Object.assign(Response.prototype, make());\n  expect(new Response("").upper()).toBe("up");\n});\n`,
  });
  const ran = await run([bunExe(), "test", "--aot", "./main.test.mjs"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  expect({ warned: (ran.stdout + ran.stderr).includes("TS100014"), exitCode: ran.exitCode }).toEqual({
    warned: false,
    exitCode: 0,
  });
}, 240_000);

test("a test lays names out of a list on Object.prototype", async () => {
  using dir = tempDir("aot-locked-built-in-write-warnings", {
    "main.test.mjs": `import { expect, test } from "bun:test";\ntest("t", () => {\n  for (const name of ["upper", "lower"]) {\n    Object.prototype[name] = () => name;\n    expect({}[name]()).toBe(name);\n    delete Object.prototype[name];\n  }\n});\n`,
  });
  const ran = await run([bunExe(), "test", "--aot", "./main.test.mjs"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  expect({ warned: (ran.stdout + ran.stderr).includes("TS100014"), exitCode: ran.exitCode }).toEqual({
    warned: false,
    exitCode: 0,
  });
}, 240_000);

test("a test replaces a member through Object.assign()", async () => {
  using dir = tempDir("aot-locked-built-in-write-warnings", {
    "main.test.mjs": `import { expect, test } from "bun:test";\nconst make = () => ({ at: () => 7 });\ntest("t", () => {\n  Object.assign(Array.prototype, make());\n  expect([1].at(0)).toBe(7);\n});\n`,
  });
  const ran = await run([bunExe(), "test", "--aot", "./main.test.mjs"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  expect({ warned: (ran.stdout + ran.stderr).includes("TS100014"), exitCode: ran.exitCode }).toEqual({
    warned: false,
    exitCode: 0,
  });
}, 240_000);
