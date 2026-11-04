import { test, vi } from "bun:test";

test("vi.doMock()", async () => {
  vi.doMock("./m", () => ({ v: "b" }));
  const { used } = await import("./user");
  console.log("b sees " + used() + "," + (globalThis as any).held());
});
