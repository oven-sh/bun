import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./index.mjs", () => ({ unit: "in" }));
  const space = await import("./area.mjs");
  const { area, sides } = space;
  console.log("a", typeof area, String(sides), Object.keys(space).join(), typeof area === "function" ? area(2, 3) : "no function");
});
