// esbuild's `__publicField(this, "x", n)` hands Object.defineProperty a written descriptor, and a descriptor is asked for `get` and `set` as well: where a test lays one of the two above every object, the
// descriptor names an accessor beside a value and plain Bun throws a TypeError. The call was laid in line as a definition without a descriptor, which asked nobody: the field was laid and the test read 3.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const library = `var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
class Base { constructor() { this.x = 1; } }
class Point extends Base { constructor(n) { super(); __publicField(this, "x", n); } }
export const made = n => new Point(n).x;
`;
const laid: Record<string, { lay: string; name: string; said: string }> = {
  "a function under get": {
    lay: `Object.prototype.get = function () { return 9; };`,
    name: "get",
    said: "TypeError 4",
  },
  "a function under set": { lay: `Object.prototype.set = function () {};`, name: "set", said: "TypeError 4" },
  "get defined by a descriptor": {
    lay: `Object.defineProperty(Object.prototype, "get", { configurable: true, value() { return 9; } });`,
    name: "get",
    said: "TypeError 4",
  },
  "undefined under get": { lay: `Object.prototype.get = undefined;`, name: "get", said: "TypeError 4" },
  "another name": { lay: `Object.prototype.got = function () { return 9; };`, name: "got", said: "3 4" },
};

for (const [name, { lay, name: key, said }] of Object.entries(laid))
  test.concurrent(name, async () => {
    using dir = tempDir("aot-public-field-below-get", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "lib.js": library,
      "a.test.js": `import { test } from "bun:test";\nimport { made } from "./lib.js";\ntest("t", () => { ${lay} let said; try { said = made(3); } catch (error) { said = error.name; } finally { delete Object.prototype.${key}; } console.error("SAID " + said + " " + made(4)); });\n`,
    });
    const answers: Record<string, unknown> = {};
    for (const [way, flags] of [
      ["plain", []],
      ["compiled", ["--aot"]],
    ] as const) {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      answers[way] = { said: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SAID ")), exitCode };
    }
    expect(answers).toEqual({
      plain: { said: ["SAID " + said], exitCode: 0 },
      compiled: { said: ["SAID " + said], exitCode: 0 },
    });
  });
