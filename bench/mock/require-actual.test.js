// Benchmark for jest.requireActual() caching performance.
// Run with: bun test bench/mock/require-actual.test.js
import { mock, jest, test, expect } from "bun:test";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";

function parseRunCount(value) {
  const count = Number(value ?? "10000");
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new TypeError("RUN_COUNT must be a positive safe integer");
  }
  return count;
}

const N = parseRunCount(process.env.RUN_COUNT);

const fixturePath = join(import.meta.dir, "require-actual-fixture.cjs");
writeFileSync(fixturePath, "module.exports = { hello: 'world', count: 42 };");

mock.module(fixturePath, () => ({ hello: "mocked" }));

test.each(["0", "-1", "abc", "1.5", "10foo", String(Number.MAX_SAFE_INTEGER + 1)])(
  "rejects invalid RUN_COUNT %p",
  value => {
    expect(() => parseRunCount(value)).toThrow("RUN_COUNT must be a positive safe integer");
  },
);

test.each([
  [undefined, 10000],
  ["1", 1],
  ["250", 250],
])("accepts valid RUN_COUNT %p", (value, expected) => {
  expect(parseRunCount(value)).toBe(expected);
});

test(`jest.requireActual() cached x ${N}`, () => {
  jest.requireActual(fixturePath);
  console.time(`requireActual (cached) x ${N}`);
  for (let i = 0; i < N; i++) {
    jest.requireActual(fixturePath);
  }
  console.timeEnd(`requireActual (cached) x ${N}`);
});

test(`require() mocked x ${N} (baseline)`, () => {
  console.time(`require (mocked) x ${N}`);
  for (let i = 0; i < N; i++) {
    require(fixturePath);
  }
  console.timeEnd(`require (mocked) x ${N}`);
});

test("cleanup", () => {
  unlinkSync(fixturePath);
});
