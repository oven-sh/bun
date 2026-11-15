import { mock, test, vi } from "bun:test";
test("a", async () => {
  await import("./half.mjs").catch(() => {});
  await import("./leaf.mjs");
  vi.doMock("./leaf.mjs", () => ({ tag: "first mock" }));
  mock.module("./leaf.mjs", () => ({ tag: "second mock" }));
  const order = [];
  mock.module("./half.mjs", () => { order.push("factory"); return { before: 7 }; });
  order.push("behind the call");
  await import("./half.mjs").then(it => order.push("loaded " + it.before), error => order.push("refused " + error.message));
  console.log("SAID", order.join(" > "));
});
