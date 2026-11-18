import { jest, mock, test, vi } from "bun:test";
test("0", async () => {
  console.log("SAID use", (await import("./user.mjs")).got());
});
