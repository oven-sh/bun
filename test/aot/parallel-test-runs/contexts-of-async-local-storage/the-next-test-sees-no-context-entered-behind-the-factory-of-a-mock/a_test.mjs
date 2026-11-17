import { test, mock } from "bun:test";
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), s = () => String(als.getStore());
const require = createRequire(import.meta.url);
mock.module("./dep.cjs", () => ({ x: 2 }));
test("the first test enters a context behind the factory", async () => {
  await 0;
  console.log("| the mock answers " + require("./dep.cjs").x);
  als.enterWith("in");
  console.log("| the first test " + s());
});
test("the second test", async () => {
  console.log("| the second test " + s());
  await new Promise(done => setTimeout(() => { console.log("| a timer of the second test " + s()); done(); }, 1));
});
