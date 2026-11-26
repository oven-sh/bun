import { test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.store = new AsyncLocalStorage();
globalThis.say = name => console.log(name, store.getStore());
test("a", async () => {
  await store.run("above.mjs", () => import("./above.mjs"));
  await store.run("above-waits.mjs", () => import("./above-waits.mjs"));
  await store.run("requires.cjs", () => import("./requires.cjs"));
  await store.run("nests.mjs", () => import("./nests.mjs"));
  say("test");
});
