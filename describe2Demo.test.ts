import { describe, expect, test } from "bun:test";

test("test one", async () => {
  console.log("<1>");
  expect(Bun.sleep(50)).resolves.toBeUndefined();
  console.log("</1>");
});

test.concurrent("test two", async () => {
  console.log("<2>");
  expect(Bun.sleep(50)).resolves.toBeUndefined();
  console.log("</2>");
});

test.concurrent("test three", async () => {
  console.log("<3>");
  expect(Bun.sleep(50)).resolves.toBeUndefined();
  console.log("</3>");
});

test("test four", async () => {
  console.log("<4>");
  expect(Bun.sleep(50)).resolves.toBeUndefined();
  console.log("</4>");
});
