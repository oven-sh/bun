import { jest, mock, test, vi } from "bun:test";
test("b", async () => {
  console.log("SAID b", (await import("@made-up/fx")).fee(), (await vi.importActual("@made-up/fx")).fee());
  console.log("SAID use", (await import("./user.mjs")).got());
});
