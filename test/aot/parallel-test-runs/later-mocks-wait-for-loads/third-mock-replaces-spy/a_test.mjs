import { jest, mock, test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("@made-up/fx", { spy: true });
  console.log("SAID first", (await import("./user.mjs")).got());
  vi.doMock("@made-up/fx", () => { console.log("SAID factory 2"); return { rate: "2R" }; });
  console.log("SAID laid");
  vi.doMock("@made-up/fx", () => ({ rate: "3R" }));
  console.log("SAID then", (await import("./user.mjs")).got());
});
