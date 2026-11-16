// toMatchObject() that fails prints a diff, and the diff does not flag a matcher that passed (https://github.com/oven-sh/bun/issues/9089). For that it asks the matchers after the first
// mismatch, which the comparison did not reach. A private field of a compiled class is in no list of names: the comparison gets what it holds from the engine, and the walk that asks the
// matchers for the diff has no row to make there. So the matchers beside a private field that differs are asked as they are beside any other mismatch.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const asked = `
import { expect, test } from "bun:test";

class Holder { #kept; constructor(kept) { this.#kept = kept; } }
class Shows { #kept; shown; constructor(kept, shown) { this.#kept = kept; this.shown = shown; } }
const calls = { before: 0, after: 0, private: 0, shared: 0 };
expect.extend({
  toBeCountedAs(received, position) { calls[position]++; return { pass: true, message: () => "" }; },
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
  console.log("SAID", JSON.stringify(flagged({ a: 1, ...around(new Shows(1, 5)) }, { a: 2, ...pattern(new Shows(2, expect.any(Number))) })));
  console.log("SAID", JSON.stringify(flagged({ a: 1, holder: new Holder(5) }, { a: 2, holder: new Holder(expect.toBeCountedAs("private")) })));
  console.log("SAID", JSON.stringify(flagged({ holder: new Holder(5), a: 1 }, { holder: new Holder(expect.toBeCountedAs("private")), a: 2 })));
  const shared = { s: 5 }, sharedPattern = { s: expect.toBeCountedAs("shared") };
  console.log("SAID", JSON.stringify(flagged({ holder: new Holder(shared), shown: shared, a: 1 }, { holder: new Holder(sharedPattern), shown: sharedPattern, a: 2 })));
  console.log("SAID", JSON.stringify(calls));
});
`;

test("each matcher beside the private field is asked once, and none is flagged", async () => {
  using dir = tempDir("aot-diff-of-a-failed-match", { "asked.test.js": asked });
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "asked.test.js"], String(dir), {
    ...bunEnv,
    BUN_AOT_VERBOSE: "1",
  });
  expect(stderr).toContain("[aot] module: ");
  expect({
    said: stdout
      .split("\n")
      .filter(line => line.startsWith("SAID "))
      .map(line => JSON.parse(line.slice(5))),
    exitCode,
  }).toEqual({
    // No line shows a private field. In the third case the comparison ends before the object with the private field,
    // and the diff goes into that object for the matcher that it shows. A matcher that a private field holds is
    // asked by the comparison alone: once in the fifth case, where the comparison comes to it. In the last case the
    // comparison goes into two objects through the private field, asks their matcher, and then meets them at a key.
    // The diff goes into them at that key and does not ask the matcher again.
    said: [
      [],
      [],
      ['-   "a": 2,', '+   "a": 1,'],
      ['-   "a": 2,', '+   "a": 1,'],
      ['-   "a": 2,', '+   "a": 1,'],
      ['-   "a": 2,', '+   "a": 1,'],
      { before: 3, after: 3, private: 1, shared: 1 },
    ],
    exitCode: 0,
  });
});
