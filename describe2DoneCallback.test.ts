import { describe, expect, test } from "bun:test";

describe("ABC", () => {
  test("DEF", done => {
    setTimeout(() => {
      done();
      done();
      done();
    }, 1000);
  });
});
// @ts-expect-error
describe("GHI", done => {
  test("no done", () => {
    expect(done).toBeUndefined();
  });
});
