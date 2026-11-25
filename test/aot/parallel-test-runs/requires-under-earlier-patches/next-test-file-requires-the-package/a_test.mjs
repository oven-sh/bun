import { jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
test("a", async () => {
  await mock.module("@made-up/tax", () => ({ rate: "first" }));
  await mock.module("@made-up/tax", () => ({ ...require("@made-up/tax"), other: "second" }));
  console.log("a", sold());
});
