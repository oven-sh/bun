// toMatchObject() that fails prints a diff, and the diff does not flag a matcher that passed (https://github.com/oven-sh/bun/issues/9089). For that it asks the matchers after the first
// mismatch, which the comparison did not reach. Two of its rules meet compiled code. A private field of a compiled class is in no list of names, so the diff has to know that the comparison
// stopped after the keys of the two objects. And an async function of expect.extend() is not called, since it would go on after the assertion has failed: a compiled function has no
// executable that says it is async, so the engine is asked.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const asked = `
import { expect, test } from "bun:test";

class Holder { #kept; constructor(kept) { this.#kept = kept; } }
const calls = { before: 0, after: 0, declared: 0, arrow: 0, method: 0 };
async function toBeDeclaredAsync() { calls.declared++; await new Promise(() => {}); }
const toBeAnAsyncArrow = async () => { calls.arrow++; await new Promise(() => {}); };
expect.extend({
  toBeCountedAs(received, position) { calls[position]++; return { pass: true, message: () => "" }; },
  toBeDeclaredAsync,
  toBeAnAsyncArrow,
  async toBeAnAsyncMethod() { calls.method++; await new Promise(() => {}); },
});
const flagged = (received, pattern) => {
  try { expect(received).toMatchObject(pattern); } catch (error) { return Bun.stripANSI(error.message).split("\\n").filter(line => /^[-+] {3}/.test(line)); }
  return ["did not throw"];
};

test("says", () => {
  const around = value => ({ before: 1, holder: value, after: 1 });
  const pattern = value => ({ before: expect.toBeCountedAs("before"), holder: value, after: expect.toBeCountedAs("after") });
  console.log("SAID", JSON.stringify(flagged(around(new Holder(1)), pattern(new Holder(2)))));
  console.log("SAID", JSON.stringify(flagged(around(new Holder({ inner: 1 })), pattern(new Holder({ inner: 2 })))));
  for (const name of ["toBeDeclaredAsync", "toBeAnAsyncArrow", "toBeAnAsyncMethod"])
    console.log("SAID", JSON.stringify(flagged({ a: 1, b: 1 }, { a: 2, b: expect[name]() })));
  console.log("SAID", JSON.stringify(calls));
});
`;

test("a private field that differs and an async matcher, both in compiled code", async () => {
  using dir = tempDir("aot-diff-of-a-failed-match", { "asked.test.js": asked });
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "asked.test.js"], String(dir), {
    ...bunEnv,
    BUN_AOT_VERBOSE: "1",
  });
  expect(stderr).toContain("[aot] module: ");
  const flagsOnly = (name: string) => ['-   "a": 2,', `-   "b": ${name} [],`, '+   "a": 1,', '+   "b": 1,'];
  expect({
    said: stdout
      .split("\n")
      .filter(line => line.startsWith("SAID "))
      .map(line => JSON.parse(line.slice(5))),
    exitCode,
  }).toEqual({
    said: [
      // No line shows a private field, and each matcher beside it passed.
      [],
      [],
      flagsOnly("toBeDeclaredAsync"),
      flagsOnly("toBeAnAsyncArrow"),
      flagsOnly("toBeAnAsyncMethod"),
      // Each matcher beside the private field is asked once for each of the two failures.
      { before: 2, after: 2, declared: 0, arrow: 0, method: 0 },
    ],
    exitCode: 0,
  });
});
