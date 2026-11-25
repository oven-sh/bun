import { jest, mock, test, vi } from "bun:test";
test("a", async () => {
  mock.module("@made-up/fx", async () => { await 0; return { rate: "fR" }; });
  try {
  jest.doMock("./tax.mjs", () => ({ ...require("./tax.mjs"), rate: "tR" }));
  const it = await import("./tax.mjs");
  console.log("SAID got", it.rate, it.under());
  } catch (error) { console.log("SAID threw", error.message.split(" is ")[0].replace(import.meta.dir, "")); }
  console.log("SAID again", await import("./tax.mjs").then(it => it.rate + it.under?.(), error => error.message.split(" is ")[0].replace(import.meta.dir, "")));
});
