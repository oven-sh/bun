import { test, vi } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
const log = [];
const store = new AsyncLocalStorage();
test("the moment and the store", async () => {
  let state = "before the call";
  vi.doMock("./part.mjs", async () => { log.push(`in ${store.getStore()}, ${state}`); await null; log.push("behind"); return { a: "mocked" }; });
  const loaded = store.run("the store of the call", () => import("./part.mjs"));
  state = "behind the call";
  for (let job = 1; job <= 6; job++) { log.push(job); await null; }
  console.log("SAID", (await loaded).a, log.join());
});
