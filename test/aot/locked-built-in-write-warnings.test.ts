import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const attempt = (statement: string) =>
  `try {\n  ${statement};\n  console.log(new Date(0).getTime());\n} catch (error) {\n  console.log(error.constructor.name);\n}\n`;

const attemptToAdd = (statement: string) =>
  `try {\n  ${statement};\n  console.log(new Response("").upper());\n} catch (error) {\n  console.log(error.constructor.name);\n}\n`;

type Program = { source: string; files?: Record<string, string>; warnings: string[]; stdout: string };
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
  "a name that the object lacks, out of another file": {
    source: attemptToAdd(`Object.assign(Response.prototype, require("./helpers.cjs"))`),
    files: { "helpers.cjs": `module.exports = { upper: () => "up" };\n` },
    warnings: ["main.mjs:2:10"],
    stdout: "TypeError\n",
  },
  "a name that the object lacks, stored behind the literal": {
    source:
      `const helpers = {};\nhelpers.upper = () => "up";\n` + attemptToAdd(`Object.assign(Response.prototype, helpers)`),
    warnings: ["main.mjs:4:10"],
    stdout: "TypeError\n",
  },
  "mock.method() of node:test": {
    source: `import { mock } from "node:test";\n` + attempt(`mock.method(Date.prototype, "getTime", () => 7)`),
    warnings: ["main.mjs:3:8"],
    stdout: "TypeError\n",
  },
};

for (const [name, { source, files, warnings, stdout }] of Object.entries(programs)) {
  test(`TS100014: ${name}`, async () => {
    using dir = tempDir("aot-locked-built-in-write-warnings", { "main.mjs": source, ...files });
    const cwd = String(dir);
    const executable = join(cwd, "main");
    const built = await run([bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable], cwd, {
      ...bunEnv,
      NO_COLOR: "1",
    });
    const said = built.stdout + built.stderr;
    expect({
      warnings: [...said.matchAll(/TS100014: [^\n]*\n\s+at \S*?(main\.mjs:\d+:\d+)/g)].map(match => match[1]),
      exitCode: built.exitCode,
    }).toEqual({ warnings, exitCode: 0 });
    expect((await run([executable], cwd)).stdout).toBe(stdout);
  }, 240_000);
}

test("a test adds a name through Object.assign()", async () => {
  using dir = tempDir("aot-locked-built-in-write-warnings", {
    "main.test.mjs": `import { expect, test } from "bun:test";\nconst make = () => ({ upper: () => "up" });\ntest("t", () => {\n  Object.assign(Response.prototype, make());\n  expect(new Response("").upper()).toBe("up");\n});\n`,
  });
  for (const words of ["TestRunLayers:0", "TestRunLayers:2"]) {
    const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
    const ran = await run([bunExe(), "test", "--aot", "./main.test.mjs"], String(dir), env);
    expect({ warned: (ran.stdout + ran.stderr).includes("TS100014"), exitCode: ran.exitCode }).toEqual({
      warned: false,
      exitCode: 0,
    });
  }
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
