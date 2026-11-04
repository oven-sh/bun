// inner.ts is imported by outer.ts alone, and a mock stands for outer.ts when user.ts is loaded.
import { vi, test } from "bun:test";
test("views", async () => {
  vi.doMock("./outer", () => ({ outer: () => "mock outer" }));
  const { run } = await import("./user");
  vi.doMock("./dep", () => ({ v: "mocked" }));
  const { readV } = await import("./inner");
  console.log(run(), "|", readV());
});
