import { test, jest, mock, vi } from "bun:test";
const order = [];
test("who calls the factory", async () => {
  await import("./shelf.mjs").catch(() => {});
  mock.module("./shelf.mjs", () => ({ behind: 9 }));
  vi.doUnmock("./shelf.mjs");
  mock.module("./shelf.mjs", () => { order.push("factory"); return { before: 7 }; });
  order.push("behind the call");
  await import("./shelf.mjs").then(it => order.push("loaded " + Object.keys(it).sort().join("+")), error => order.push("refused " + error.message));
  console.log(order.join(" > "));
});
