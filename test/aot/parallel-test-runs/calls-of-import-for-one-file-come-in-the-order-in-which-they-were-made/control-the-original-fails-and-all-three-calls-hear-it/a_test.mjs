import { test, vi } from "bun:test";
const say = (...values) => console.log("SAID", ...values.map(value => JSON.stringify(value)));
test("one", () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), more: 1 }));
  for (const n of [1, 2, 3]) import("./part.mjs").then(it => say("call " + n + " came", it.v, it.more), error => say("call " + n + " failed", error.message));
});
