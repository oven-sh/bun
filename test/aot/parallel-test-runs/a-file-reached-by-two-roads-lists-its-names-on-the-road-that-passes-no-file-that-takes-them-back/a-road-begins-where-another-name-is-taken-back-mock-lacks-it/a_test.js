import { test, vi } from "bun:test";
test("who has the name", async () => {
  vi.doMock("./shapes.mjs", () => ({ square: 20 }));
  console.log("SAID", (await import("./reader.mjs")).look(process.argv.length > 9));
});
