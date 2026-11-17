import { test, vi } from "bun:test";
import { read } from "./reader";
vi.doMock("./dep", () => ({ value: () => "mock a" }));
test("a", async () => {
  const later = await import("./later");
  console.log("a", read(), later.seen());
});
