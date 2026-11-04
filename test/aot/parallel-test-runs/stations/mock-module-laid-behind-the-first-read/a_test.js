// The reader has read through the barrel three hundred times when `mock.module()` is laid over the file that declares. Then it reads again, and again behind `mock.restore()`.
import { mock, test } from "bun:test";
import { read, readOffObject } from "./reader.js";

test("a mock laid behind the first read", async () => {
  let seen = "";
  for (let i = 0; i < 300; i++) seen = read() + "," + readOffObject();
  console.log("| before", seen);
  await mock.module("./lib.js", () => ({ fn: () => "mock fn", flag: "mock flag" }));
  console.log("| mocked", read(), readOffObject());
  for (let i = 0; i < 300; i++) seen = read() + "," + readOffObject();
  console.log("| mocked, in a loop", seen);
  mock.restore();
  console.log("| restored", read(), readOffObject());
});

test("the next test", () => {
  console.log("| the next test", read(), readOffObject());
});
