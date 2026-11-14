import { jest, mock, test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("@made-up/fx", () => { console.log("SAID factory 1"); return { rate: "1R" }; });
  console.log("SAID first", (await import("./user.mjs")).got());
  vi.doMock("@made-up/fx", () => { console.log("SAID factory 2"); return { rate: "2R" }; });
  console.log("SAID laid");
});
