import { describe, test } from "bun:test";

console.log("HIT 1");
describe("abc", () => {
  console.log("HIT 2");

  test("1", () => {});
});
console.log("HIT 3");
describe("abc", () => {
  console.log("HIT 4");
  test("2", () => {});
  describe("abc", () => {
    console.log("HIT 7");
    test("3", () => {});
  });
  console.log("HIT 5");
  test("4", () => {});
  describe("abc", () => {
    console.log("HIT 8");
    test("5", () => {});
  });
  console.log("HIT 6");
  test("6", () => {});
});
console.log("HIT 9");
test("7", () => {});
await Promise.resolve(undefined);

const { promise, resolve } = Promise.withResolvers();

console.log("HIT 10");
test("8", () => {});
describe("abc", async () => {
  console.log("HIT 11");
  test("9", () => {});
  describe("abc", async () => {
    test("10", () => {});
    console.log("HIT 14");
  });
  test("11", () => {});
});
test("12", () => {});
console.log("HIT 12");
describe("def", async () => {
  test("13", () => {});
  console.log("HIT 15");
  describe("def", async () => {
    test("14", () => {});
    console.log("HIT 16");
  });
  test("15", () => {});
  describe("def", () => {
    test("16", () => {});
    console.log("HIT 17");
  });
  test("17", () => {});
  describe("def", async () => {
    test("18", () => {});
    console.log("HIT 18");
    resolve();
    test("19", () => {});
  });
  test("20", () => {});
});
console.log("HIT 13");
test("21", () => {});

await promise;
console.log("ready to run tests now");

await describe.forDebuggingExecuteTestsNow();
describe.forDebuggingDeinitNow();

/*
this one needs async context to handle properly:
describe("abc", () => {
  setTimeout(() => {
    describe("def", () => {
    
    });
  }, 0);
})

oh and here's the problem we're hitting:
describe("", async () => {
  describe("", async () => {
  });
});
the issue is that we call:
- describe
- inner describe
but we don't know 

we should look at vitest and see how it does describe ordering.

*/
