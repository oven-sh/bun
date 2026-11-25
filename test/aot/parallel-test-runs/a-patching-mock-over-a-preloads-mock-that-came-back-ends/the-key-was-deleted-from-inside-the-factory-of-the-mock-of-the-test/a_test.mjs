import { mock, test, vi } from "bun:test";
test("t", async () => {
  const said = [require("./g.cjs").word];
  vi.doMock("./g.cjs", () => {
    delete require.cache[require.resolve("./g.cjs")];
    return { word: "own" };
  });
  said.push(require("./g.cjs").word);
  vi.doUnmock("./g.cjs");
  const h = await import("./h.mjs");
  said.push(h.read());
  mock.module("./g.cjs", () => ({ word: "patch" }));
  said.push(h.read());
  vi.doUnmock("./g.cjs");
  said.push(h.read(), require("./g.cjs").word, (await import("./g.cjs")).word, (await import("./later.mjs")).read());
  console.log("SAID " + said.join(" ") + " " + (globalThis.runs ?? 0));
});
