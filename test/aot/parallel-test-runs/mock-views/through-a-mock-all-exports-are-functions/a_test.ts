import { vi, test } from "bun:test";
test("views", async () => {
  vi.doMock("./outer", () => ({ outer: () => "mock outer" }));
  const { run } = await import("./user");
  vi.doMock("./dep", () => ({ v: () => "mocked" }));
  const { readV } = await import("./inner");
  console.log(run(), "|", readV());
});
