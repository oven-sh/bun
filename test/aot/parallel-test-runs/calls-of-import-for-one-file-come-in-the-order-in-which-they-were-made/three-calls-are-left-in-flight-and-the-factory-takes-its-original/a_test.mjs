import { afterEach, test, vi } from "bun:test";
const say = (...values) => console.log("SAID", ...values.map(value => JSON.stringify(value)));
test("one", () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), more: 1 }));
  import("./part.mjs").then(it => say("call 1 came", it.v, it.more), error => say("call 1 failed", error.message));
  import("./part.mjs").then(it => say("call 2 came", it.v, it.more), error => say("call 2 failed", error.message));
  import("./part.mjs").then(it => say("call 3 came", it.v, it.more), error => say("call 3 failed", error.message));
});
