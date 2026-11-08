import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// A loop calls a method of what is declared a Map or a list. Something of another class comes (a Set, a WeakMap, a text), and the test has replaced that class's method.
// The call behind the failed look asks the declared class alone and then looks the method up: the walk has only said that the declared class's member is as built.
async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

async function expectCompiledToRunAsPlain(body: string) {
  using dir = tempDir("a-call-behind-a-failed-look", {
    "one.test.ts": `import { test } from "bun:test";
      test("replaced in a test run", () => {
        ${body}
      });`,
  });
  const plain = await runTests(String(dir));
  expect(plain.results).toEqual(["pass replaced in a test run"]);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}

const phases = (replace: string, restore: string) => `
  function phase(): void { let last = ""; for (let turn = 0; turn < 300; turn++) last = sweep(); console.log(last); }
  phase(); ${replace} phase(); ${restore} phase();`;

test("has() of a Set under a declared Map", async () => {
  await expectCompiledToRunAsPlain(`
    const all = new Set<Map<string, number>>([new (class Tracked extends Map<string, number> { tag = 1 })(), new Map([["a", 1]]), new Set(["a"]) as any]);
    function sweep(): string { let out = ""; for (const one of all) out += String(one.has("a")) + ","; return out; }
    const kept = Set.prototype.has;
    ${phases(`(Set.prototype as any).has = function () { return "fake"; };`, `Set.prototype.has = kept;`)}`);
});

test("get() and set() of a WeakMap under a declared Map", async () => {
  await expectCompiledToRunAsPlain(`
    const key = {};
    const all = new Set<Map<object, number>>([new (class Tracked extends Map<object, number> { tag = 1 })(), new Map(), new WeakMap() as any]);
    function sweep(): string { let out = ""; for (const one of all) { one.set(key, 1); out += String(one.get(key)) + ","; } return out; }
    const get = WeakMap.prototype.get, set = WeakMap.prototype.set;
    ${phases(`(WeakMap.prototype as any).get = function () { return "fake"; }; (WeakMap.prototype as any).set = function () { console.log("set"); return this; };`, `WeakMap.prototype.get = get; WeakMap.prototype.set = set;`)}`);
});

test("the same where an operand is a call, so that the method is read first and called by value", async () => {
  await expectCompiledToRunAsPlain(`
    const key = {};
    function pick<T>(value: T): T { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return value; }
    const maps = new Set<Map<object, number>>([new (class Tracked extends Map<object, number> { tag = 1 })(), new Map(), new WeakMap() as any]);
    const sets = new Set<Map<string, number>>([new (class Kept extends Map<string, number> { tag = 1 })(), new Map([["a", 1]]), new Set(["a"]) as any]);
    const lists = new Set<string[]>([new (class Row extends Array<string> { tag = 1 })(), ["a"], "ba" as any]);
    function sweep(): string {
      let out = "";
      for (const one of maps) { one.set(key, 1); out += String(one.get(pick(key))) + ","; }
      for (const one of sets) out += String(one.has(pick("a"))) + ",";
      for (const one of lists) out += String(one.indexOf(pick("a"))) + ",";
      return out;
    }
    const get = WeakMap.prototype.get, has = Set.prototype.has, indexOf = String.prototype.indexOf;
    ${phases(`(WeakMap.prototype as any).get = function () { return "fake"; }; (Set.prototype as any).has = function () { return "fake"; }; (String.prototype as any).indexOf = function () { return "fake"; };`, `WeakMap.prototype.get = get; Set.prototype.has = has; String.prototype.indexOf = indexOf;`)}`);
});

test("indexOf() and slice() of a text under a declared list, and under no declared type", async () => {
  for (const declared of ["string[]", "any"]) {
    await expectCompiledToRunAsPlain(`
      const all = new Set<${declared}>([new (class Tracked extends Array<string> { tag = 1 })(), ["a"], "ba" as any]);
      function sweep(): string { let out = ""; for (const one of all) out += String(one.indexOf("a")) + String(one.slice(1)) + ","; return out; }
      const indexOf = String.prototype.indexOf, slice = String.prototype.slice;
      ${phases(`(String.prototype as any).indexOf = function () { return "fake"; }; (String.prototype as any).slice = function () { return "cut"; };`, `String.prototype.indexOf = indexOf; String.prototype.slice = slice;`)}`);
  }
});
