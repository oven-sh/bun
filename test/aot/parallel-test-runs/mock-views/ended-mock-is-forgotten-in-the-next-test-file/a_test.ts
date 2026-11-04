import { test, vi } from "bun:test";

test("the reader is linked to a mock, which ends", async () => {
  vi.doMock("./lib", () => ({ who: "mock" }));
  const reader = await import("./reader");
  console.log("a, mocked:", reader.read());
  vi.doUnmock("./lib");
  console.log("a, ended:", reader.read());
});
