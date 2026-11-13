import { test, vi } from "bun:test";
test("what the barrel shows", async () => {
  vi.doMock("./mocked.mjs", async importOriginal => ({ ...(await importOriginal()), round: 9, square: 4 }));
  console.log((await import("./reader.mjs")).look());
});
