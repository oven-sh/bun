import { test, mock, vi } from "bun:test";
const order = [];
test("who calls the factory", async () => {
  await import("./shelf.mjs").catch(() => {});
  await import("./tools.cjs");
  vi.doMock("./tools.cjs", () => ({ name: 5 }));
  vi.doMock("./tools.cjs", () => { order.push("second factory of tools"); return { name: 6 }; });
  mock.module("./shelf.mjs", () => { order.push("factory"); return { before: 7 }; });
  order.push("behind the call");
  await import("./shelf.mjs").then(it => order.push("loaded " + Object.keys(it).sort().join("+")), error => order.push("refused " + error.message));
  console.log("SAID", order.join(" > "));
});
