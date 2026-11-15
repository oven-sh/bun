import { mock, test } from "bun:test";
import { sold } from "./sale.mjs";
test("c", async () => {
  Bun.gc(true);
  console.log("c", sold());
  await mock.module("@made-up/fx", async () => { await 0; return { rate: "fxMock" }; });
  console.log("c", (await import("./sale.mjs")).sold());
});
