import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

beforeAll(() => {
  console.log("beforeAll [should run]");
});
afterAll(() => {
  console.log("afterAll [should run]");
});
beforeEach(() => {
  console.log("beforeEach [should run]");
});
afterEach(() => {
  console.log("afterEach [should run]");
});
describe("inside describe", () => {
  beforeAll(() => {
    console.log("beforeAll [should not run]");
  });
  beforeEach(() => {
    console.log("beforeEach [should not run]");
  });
  afterEach(() => {
    console.log("afterEach [should not run]");
  });
  afterAll(() => {
    console.log("afterAll [should not run]");
  });
  test("this test is in a describe", () => {
    console.log("test [should not run]");
  });
});
describe("inside describe 2", () => {
  beforeAll(() => {
    console.log("beforeAll [should run]");
  });
  beforeEach(() => {
    console.log("beforeEach [should run]");
  });
  afterEach(() => {
    console.log("afterEach [should run]");
  });
  afterAll(() => {
    console.log("afterAll [should run]");
  });
  test.only("this test is only'd and should run", () => {
    console.log("test [should run]");
  });
});

await describe.forDebuggingExecuteTestsNow();
describe.forDebuggingDeinitNow();
