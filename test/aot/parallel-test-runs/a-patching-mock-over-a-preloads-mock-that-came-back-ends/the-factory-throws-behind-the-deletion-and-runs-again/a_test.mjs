import { mock, test, vi } from "bun:test";
test("t", async () => {
  const said = [require("./g.cjs").word];
  let calls = 0;
  vi.doMock("./g.cjs", () => {
    delete require.cache[require.resolve("./g.cjs")];
    if (++calls === 1) throw new RangeError("slips");
    return { word: "own" };
  });
  for (let round = 0; round < 2; round++) {
    try { said.push(require("./g.cjs").word); } catch (error) { said.push("threw:" + error.message); }
  }
  vi.doUnmock("./g.cjs");
  const h = await import("./h.mjs");
  mock.module("./g.cjs", () => ({ word: "patch" }));
  said.push(h.read());
  vi.doUnmock("./g.cjs");
  said.push(h.read(), require("./g.cjs").word);
  console.log("SAID " + said.join(" ") + " " + calls + " " + (globalThis.runs ?? 0));
});
