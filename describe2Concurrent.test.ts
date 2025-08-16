import { test, describe, beforeAll } from "bun:test";

function sleep() {
  return new Promise(r => setTimeout(r, 100));
}

test("test 1", async () => {
  console.log("start test 1");
  await sleep();
  console.log("end test 1");
});
test.concurrent("test 2", async () => {
  console.log("start test 2");
  await sleep();
  console.log("end test 2");
});
test.concurrent("test 3", async () => {
  console.log("start test 3");
  await sleep();
  console.log("end test 3");
});
test("test 4", async () => {
  console.log("start test 4");
  await sleep();
  console.log("end test 4");
});
test.concurrent("test 5", async () => {
  console.log("start test 5");
  await sleep();
  console.log("end test 5");
});
test.concurrent("test 6", async () => {
  console.log("start test 6");
  await sleep();
  console.log("end test 6");
});

describe.concurrent("describe group 7", () => {
  beforeAll(async () => {
    console.log("start before test 7");
    await sleep();
    console.log("end before test 7");
  });

  test("test 7", async () => {
    console.log("start test 7");
    await sleep();
    console.log("end test 7");
  });
});
describe("describe group 8", () => {
  test.concurrent("test 8", async () => {
    console.log("start test 8");
    await sleep();
    console.log("end test 8");
  });
});

console.log("before exec");
await describe.forDebuggingExecuteTestsNow();
console.log("after exec");
describe.forDebuggingDeinitNow();

/*
Vitest order is:

[1] [2,3] [4] [5,6,7] [8]
*/
