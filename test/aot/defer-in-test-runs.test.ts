// In a test run the built-in objects take new names. A file fills an object by assignments when it is loaded. Then the test lays a setter, or a value that is read-only, on
// Object.prototype or Function.prototype. An assignment made from then on is caught or refused, so an initializer that assigns is not put off until the first read of its variable.
// ./parallel/lazy-initializers/frozen-later and its neighbours have what an executable lets through.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const lib = `
const E = {};
E.a = 0;
E.b = 1;
E.c = { x: 1 };
const f = function () {};
f.tag = "T";
f.more = { x: 1 };
f.third = { x: 2 };
exports.read = () => E;
exports.readFunction = () => f;
`;
const setter = (holder: string, name: string) =>
  `Object.defineProperty(${holder}, "${name}", { set(v) { console.log("says| the setter of ${name} runs"); }, configurable: true });`;
const readOnly = (holder: string, name: string) =>
  `Object.defineProperty(${holder}, "${name}", { value: "above", writable: false, configurable: true });`;

for (const [name, act] of Object.entries({
  "a setter on Object.prototype": setter("Object.prototype", "a") + setter("Object.prototype", "tag"),
  "a read-only value on Object.prototype": readOnly("Object.prototype", "a") + readOnly("Object.prototype", "tag"),
  "a setter on Function.prototype": setter("Function.prototype", "tag"),
  "nothing": "",
}))
  test(
    name,
    async () => {
      using dir = tempDir("aot-defer-in-test-runs", {
        "package.json": "{}",
        "lib.cjs": lib,
        "main.test.js": `
          const { read, readFunction } = require("./lib.cjs");
          ${act}
          test("reads", () => { console.log("says|", JSON.stringify(read()), Object.keys(readFunction()).join()); });`,
      });
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
      expect({
        says: stdout.split("\n").filter(line => line.startsWith("says|")),
        exitCode,
        stderr: exitCode ? stderr : "",
      }).toEqual({
        says: [`says| {"a":0,"b":1,"c":{"x":1}} tag,more,third`],
        exitCode: 0,
        stderr: "",
      });
    },
    240_000,
  );
