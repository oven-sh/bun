import { describe, test, beforeEach, afterEach } from "bun:test";

beforeEach(() => {
  console.log("beforeEach 1");
});
beforeEach(() => {
  console.log("beforeEach 2");
});

afterEach(() => {
  console.log("afterEach 2");
});
afterEach(() => {
  console.log("afterEach 1");
});

describe("sub", () => {
  beforeEach(() => {
    console.log("beforeEach 3");
  });
  beforeEach(() => {
    console.log("beforeEach 4");
  });

  test("main", () => {
    console.log("executed test");
  });

  describe("sub2", () => {
    test("mainsub", () => {
      console.log("executed sub-test");
    });
  });

  afterEach(() => {
    console.log("afterEach 4");
  });
  afterEach(() => {
    console.log("afterEach 3");
  });
});

if ("forDebuggingExecuteTestsNow" in describe) {
  await describe.forDebuggingExecuteTestsNow();
  describe.forDebuggingDeinitNow();
}
