// Runner-level verdict (no todo, no outcome hook): what a user sees from `bun test` / `node --test`.
const { test, describe, beforeEach } = require("node:test");

test("T1 plan mismatch, object validator on the message", { expectFailure: { message: /plan expected/ } }, t => {
  t.plan(2);
});

describe("suite with a failing beforeEach", () => {
  beforeEach(() => {
    throw new TypeError("db not reachable");
  });
  test("T2 beforeEach throws, RegExp on the hook's message", { expectFailure: /db not reachable/ }, () => {});
  test("T3 beforeEach throws, class of the hook's error", { expectFailure: TypeError }, () => {});
});

test("T4 timeout, RegExp anchored on main's String(error)", { timeout: 10, expectFailure: /^Error: test timed out/ }, () => new Promise(() => {}));

test("T5 throw 0, function validator", { expectFailure: e => e === 0 }, () => {
  throw 0;
});

test("T6 control: thrown Error, object validator", { expectFailure: { message: "boom" } }, () => {
  throw new Error("boom");
});
