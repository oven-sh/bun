import { test, describe, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";

describe("describe one", () => {
  beforeEach(() => {
    console.log("l1-before");
  });
  afterEach(() => {
    console.log("l1-after");
  });

  console.log("l1");
  test("test one", () => {
    console.log("t1");
  });
  test("test test two", () => {
    console.log("t2");
  });
});
test("test three", () => {
  console.log("t3");
});
describe("describe two", () => {
  beforeAll(() => {
    console.log("l2-before");
  });
  afterAll(() => {
    console.log("l2-after");
  });

  console.log("l2");
  test("test four", () => {
    console.log("t4");
  });
  test("test five", () => {
    console.log("t5");
  });
});

setInterval(() => {}, 1000);
process.on("unhandledRejection", reason => {
  console.log("unhandledRejection", reason);
});
process.on("uncaughtException", error => {
  console.log("uncaughtException", error);
});

console.log("before exec");
await describe.forDebuggingExecuteTestsNow();
console.log("after exec");
describe.forDebuggingDeinitNow();
