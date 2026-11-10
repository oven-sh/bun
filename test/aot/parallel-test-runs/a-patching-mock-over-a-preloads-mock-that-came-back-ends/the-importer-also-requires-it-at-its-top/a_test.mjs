import { mock, test, vi } from "bun:test";
test("t", async () => {
  const h = await import("./h.mjs");
  console.log("SAID begin " + h.word + " " + h.again);
  for (let round = 0; round < 2; round++) {
    const between = [];
    vi.doMock("./g.cjs", () => ({ word: "do" + round }));
    vi.doUnmock("./g.cjs");
    mock.module("./g.cjs", () => ({ word: "module" + round }));
    vi.doUnmock("./g.cjs");
    const required = require("./g.cjs").word;
    const imported = (await import("./g.cjs")).word;
    console.log("SAID " + round + " " + required + " " + imported + " " + between.join() + " " + (globalThis.runs ?? 0));
  }
});
