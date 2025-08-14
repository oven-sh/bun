import { describe, test, beforeAll, afterAll } from "bun:test";

beforeAll(() => {
  console.log("beforeAll 1");
});
beforeAll(() => {
  console.log("beforeAll 2");
});

afterAll(() => {
  console.log("afterAll 2");
});
afterAll(() => {
  console.log("afterAll 1");
});

describe("sub", () => {
  beforeAll(() => {
    console.log("beforeAll 3");
  });
  beforeAll(() => {
    console.log("beforeAll 4");
  });

  test("main", () => {
    console.log("executed test");
  });

  describe("sub2", () => {
    test("mainsub", () => {
      console.log("executed sub-test");
    });
  });

  afterAll(() => {
    console.log("afterAll 4");
  });
  afterAll(() => {
    console.log("afterAll 3");
  });
});

if ("forDebuggingExecuteTestsNow" in describe) {
  await describe.forDebuggingExecuteTestsNow();
}
