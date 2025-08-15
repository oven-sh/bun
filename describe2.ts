import { describe, test } from "bun:test";

// .split("\n").map((line, lineno) => line.replaceAll(/"LINE d+"/g, '"LINE '+(lineno+1)+'"')).join("\n"))

console.log("LINE 5");
describe("LINE 6", () => {
  console.log("LINE 7");

  test("LINE 9", () => console.log("LINE 9"));
});
console.log("LINE 11");
describe("LINE 12", () => {
  console.log("LINE 13");
  test("LINE 14", () => console.log("LINE 14"));
  describe("LINE 15", () => {
    console.log("LINE 16");
    test("LINE 17", () => console.log("LINE 17"));
  });
  console.log("LINE 19");
  test("LINE 20", () => console.log("LINE 20"));
  describe("LINE 21", () => {
    console.log("LINE 22");
    test("LINE 23", () => console.log("LINE 23"));
  });
  console.log("LINE 25");
  test("LINE 26", () => console.log("LINE 26"));
});
console.log("LINE 28");
test("LINE 29", () => console.log("LINE 29"));
await Promise.resolve(undefined);

console.log("LINE 32");
test("LINE 33", () => console.log("LINE 33"));
describe("LINE 34", async () => {
  console.log("LINE 35");
  test("LINE 36", () => console.log("LINE 36"));
  describe("LINE 37", async () => {
    test("LINE 38", () => console.log("LINE 38"));
    console.log("LINE 39");
  });
  test("LINE 41", () => console.log("LINE 41"));
});
test("LINE 43", () => console.log("LINE 43"));
console.log("LINE 44");
describe("LINE 45", async () => {
  test("LINE 46", () => console.log("LINE 46"));
  console.log("LINE 47");
  describe("LINE 48", async () => {
    test("LINE 49", () => console.log("LINE 49"));
    console.log("LINE 50");
  });
  test("LINE 52", () => console.log("LINE 52"));
  describe("LINE 53", () => {
    test("LINE 54", () => console.log("LINE 54"));
    console.log("LINE 55");
  });
  test("LINE 57", () => console.log("LINE 57"));
  describe("LINE 58", async () => {
    test("LINE 59", () => console.log("LINE 59"));
    console.log("LINE 60");
    test("LINE 61", () => console.log("LINE 61"));
  });
  test("LINE 63", () => console.log("LINE 63"));
});
console.log("LINE 65");
test("LINE 66", () => console.log("LINE 66"));

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
