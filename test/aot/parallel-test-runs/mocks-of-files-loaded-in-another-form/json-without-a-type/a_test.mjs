import { test, vi } from "bun:test";
import text from "./data.json" with { type: "text" };
test("a", async () => {
  console.log(text.trim());
  vi.doMock("./data.json", () => ({ default: "mock", v: "mock" }));
  console.log(JSON.stringify((await import("./data.json")).default), JSON.stringify((await import("./data.json", { with: { type: "json" } })).default));
  vi.doUnmock("./data.json");
  console.log(JSON.stringify((await import("./data.json")).default));
});
