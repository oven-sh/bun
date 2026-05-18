// Benchmark for jest.requireActual() caching performance.
// Run with: bun test bench/mock/require-actual.test.js
import { mock, jest, test, expect } from "bun:test";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const fixturePath = join(import.meta.dir, "require-actual-fixture.cjs");
writeFileSync(fixturePath, "module.exports = { hello: 'world', count: 42 };");

mock.module(fixturePath, () => ({ hello: "mocked" }));

const N = parseInt(process.env.RUN_COUNT || "10000", 10);

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

test("cleanup", () => { unlinkSync(fixturePath); });
