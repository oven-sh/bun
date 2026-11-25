import { test, vi, jest, mock } from "bun:test";
import text from "./part.mjs" with { type: "text" };
test("a", async () => {
  console.log(text.length > 0);
  vi.doMock("./part.mjs", () => ({ x: "mock" }));
  console.log((await import("./part.mjs")).x, require("./part.mjs").x, globalThis.bodies);
  vi.doUnmock("./part.mjs");
  console.log((await import("./part.mjs")).x, globalThis.bodies);
});
