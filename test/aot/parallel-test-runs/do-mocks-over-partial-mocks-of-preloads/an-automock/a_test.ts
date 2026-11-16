import { test, vi } from "bun:test";
import { get } from "./app";
test("the importers run again under the mock of the test", async () => {
  console.log("SAID", get());
  vi.doMock("./api.ts", () => ({ get: () => "test" }));
  const again = await import("./app");
  console.log("SAID", again.get(), get());
});
