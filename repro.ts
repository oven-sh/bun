import { expect, it, afterEach, test, describe, beforeEach, beforeAll } from "bun:test";

let set: Set<string> | null;
beforeEach(() => {
  console.log("outer beforeEach");
  set = new Set();
});
afterEach(() => {
  console.log("outer afterEach");
  set = null;
});

describe("get", () => {
  beforeEach(() => {
    console.log("inner beforeEach");
    set!.add("value1");
    set!.add("value2");
  });

  it("gets all values associated with a key", () => {
    console.log("inner it");
    expect(set!.size).toBe(2);
  });
});
