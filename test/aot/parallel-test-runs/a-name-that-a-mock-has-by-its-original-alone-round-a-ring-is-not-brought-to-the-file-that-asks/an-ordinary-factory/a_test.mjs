import { test, vi } from "bun:test";
test("what the barrel shows", async () => {
  vi.doMock("./mocked.mjs", () => ({ round: 9, square: 4 }));
  console.log((await import("./reader.mjs")).look());
});
