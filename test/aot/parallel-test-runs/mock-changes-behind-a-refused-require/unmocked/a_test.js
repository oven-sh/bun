import { vi, test } from "bun:test";
globalThis.bodies = [];
const tried = read => { try { return String(read()); } catch (e) { return "threw " + e.name; } };
test("a", async () => {
  vi.doMock("./inner.js", async () => { await 0; return { value: "inner mock" }; });
  console.log("SAID require " + tried(() => import.meta.require("./dep.js").value));
  for (let tick = 0; tick < 40; tick++) {
    if (tick === 6) vi.doUnmock("./inner.js");
    await 0;
  }
  console.log("SAID the first evaluation saw " + globalThis.bodies[0]);
});
