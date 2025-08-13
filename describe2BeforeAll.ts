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

  afterAll(() => {
    console.log("afterAll 4");
  });
  afterAll(() => {
    console.log("afterAll 3");
  });

  test("main", () => {
    console.log("test");
  });
});

console.log("ready to run tests now");

await describe.forDebuggingExecuteTestsNow();
describe.forDebuggingDeinitNow();
