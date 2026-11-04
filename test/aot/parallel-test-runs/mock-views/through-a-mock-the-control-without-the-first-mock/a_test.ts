// The control: outer.ts is not mocked, so inner.ts is loaded with user.ts.
import { vi, test } from "bun:test";
test("views", async () => {
  const { run } = await import("./user");
  vi.doMock("./dep", () => ({ v: "mocked" }));
  const { readV } = await import("./inner");
  console.log(run(), "|", readV());
});
