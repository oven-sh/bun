import { test, mock, vi } from "bun:test";
const waiting = setTimeout(() => { console.log("SAID still waiting"); process.exit(4); }, 3000);
waiting.unref();
const order = [];
test("who calls the factory", async () => {
  await import("./shelf.mjs").catch(() => {});
  await import("tools-kit");
  vi.doMock("tools-kit", () => ({ name: 5 }));
  mock.module("tools-kit", () => { order.push("second factory of tools"); return { name: 6 }; });
  mock.module("./shelf.mjs", () => { order.push("factory"); return { before: 7 }; });
  order.push("behind the call");
  await import("./shelf.mjs").then(it => order.push("loaded " + Object.keys(it).sort().join("+")), error => order.push("refused " + error.message));
  console.log("SAID", order.join(" > "));
  clearTimeout(waiting);
});
