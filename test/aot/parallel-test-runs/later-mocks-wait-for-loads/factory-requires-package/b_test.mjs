import { jest, mock, test, vi } from "bun:test";
test("b", async () => {
  console.log("SAID b", (await import("./user.mjs")).got(), (await import("@made-up/fx")).fee());
});
