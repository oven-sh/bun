import { jest, mock, test, vi } from "bun:test";
test("a", async () => {
  console.log("a", await vi.importActual("./tax.mjs").then(it => it.below(), e => e.name));
});
