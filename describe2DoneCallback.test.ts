import { describe, expect, test } from "bun:test";

describe("ABC", () => {
  test("DEF", done => {
    setTimeout(() => {
      done();
      done();
      done();
    }, 100);
  });
});
// @ts-expect-error
describe("GHI", done => {
  test("no done", () => {
    expect(done).toBeUndefined();
  });
});

test("instant done", done => {
  done();
});
test("delayed done", done => {
  setTimeout(() => {
    done();
  }, 100);
});
test("more functions called after delayed done", done => {
  process.nextTick(() => {
    done();
    expect(true).toBe(false);
  });
});
test("another test", async () => {});

test("ordering", done => {
  process.nextTick(() => {
    console.log("L1");
    done();
    console.log("L3");
  });
});
test("ordering 2", () => {
  console.log("L2");
});

test("forcing an error to go to the wrong function", () => {
  setTimeout(() => expect(false).toBe(true), 0);
});
test("the error goes to this function", done => {
  setTimeout(done, 100);
});
