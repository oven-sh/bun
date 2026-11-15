import { jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
test("a", async () => {
  await mock.module("./tax.mjs", () => ({ rate: "first" }));
  await mock.module("./tax.mjs", () => ({ ...require("./tax.mjs"), other: "second" }));
  console.log("a", sold());
});
