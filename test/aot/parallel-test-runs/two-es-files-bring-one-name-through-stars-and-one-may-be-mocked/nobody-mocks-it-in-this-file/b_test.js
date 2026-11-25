import { test, vi } from "bun:test";
test("another file mocks it", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  console.log("SAID", (await import("./shapes.mjs")).round);
});
