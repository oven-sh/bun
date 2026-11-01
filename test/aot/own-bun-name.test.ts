// A file that is no test file and uses a global of the test runner asks, where it runs, who loaded it. What the build writes for that question reads the object `Bun`,
// and a file may call something else `Bun`: `const Bun = globalThis.Bun` in code that also runs on Node.
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { expectCompiledToRunAsPlain } from "./harness/require-cache-in-test-runs";
import { test as oneAtATime } from "./supported";

raiseDefaultTimeout(240_000);

const test = oneAtATime.concurrent;

const check = (read: string) => `() => { expect(1).toBe(1); return String(${read}) + " " + typeof vi; }`;
const testFile = (helper: string) => `
import { check } from ${JSON.stringify(helper)};
test("the helper has the globals of the runner and its own Bun", () => console.log(check()));`;

const declarations = {
  "a constant": [`const Bun = { own: "own" };`, "Bun.own"],
  "the global under its own name": [`const Bun = (globalThis as any).Bun;`, "typeof Bun.version"],
  "a pattern": [`const { Bun } = globalThis as any;`, "typeof Bun.version"],
  "a var": [`var Bun = { own: "own" };`, "Bun.own"],
  "a function": [`function Bun() { return "own"; }`, "Bun()"],
  "a class": [`class Bun { static own = "own"; }`, "Bun.own"],
  "an import": [`import { own as Bun } from "./own";`, "Bun()"],
  "the module": [`import Bun from "bun";`, "typeof Bun.version"],
  "a declaration without code": [`declare const Bun: { version: string };`, "typeof Bun.version"],
  "a local beside the use": [`const inner = () => { const Bun = "own"; expect(2).toBe(2); return Bun; };`, "inner()"],
  "what is caught": [
    `const inner = () => { try { throw "own"; } catch (Bun) { expect(2).toBe(2); return Bun; } };`,
    "inner()",
  ],
  "a parameter": [`const inner = (Bun: string) => { expect(2).toBe(2); return Bun; };`, `inner("own")`],
};

for (const [title, [declaration, read]] of Object.entries(declarations)) {
  test(`Bun is ${title}`, async () => {
    await expectCompiledToRunAsPlain({
      "own.ts": `export function own() { return "own"; }`,
      "helper.ts": `${declaration}\nexport const check = ${check(read)};`,
      "a.test.ts": testFile("./helper"),
    });
  });
}

test("in a file of JavaScript", async () => {
  await expectCompiledToRunAsPlain({
    "helper.js": `const Bun = globalThis.Bun;\nexport const check = ${check("typeof Bun.version")};`,
    "a.test.ts": testFile("./helper.js"),
  });
});

test("in a CommonJS file", async () => {
  await expectCompiledToRunAsPlain({
    "helper.cjs": `const Bun = globalThis.Bun;\nexports.check = ${check("typeof Bun.version")};`,
    "a.test.ts": testFile("./helper.cjs"),
  });
});
