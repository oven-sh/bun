import { test, vi } from "bun:test";
import text from "./part.mjs" with { type: "text" };
test("a file that was loaded as text alone", async () => {
  console.log(text.length > 0);
  vi.doMock("./part.mjs", () => ({ x: "mock" }));
  console.log((await import("./part.mjs")).x);
});
