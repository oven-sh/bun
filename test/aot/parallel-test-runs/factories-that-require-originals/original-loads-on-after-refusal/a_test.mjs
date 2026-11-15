import { jest, test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./fx.mjs", async () => { await 0; return { rate: "fxMock" }; });
  jest.doMock("./tax.mjs", () => ({ ...require("./tax.mjs"), rate: "taxMock" }));
  console.log(await import("./tax.mjs").then(it => it.rate, error => error.name));
  console.log(await import("./tax.mjs").then(it => it.rate, error => error.name));
  console.log((await import("./user.mjs")).used());
});
