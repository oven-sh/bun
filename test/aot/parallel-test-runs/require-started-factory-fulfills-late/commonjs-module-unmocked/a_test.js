import { test, vi } from "bun:test";
const turn = () => new Promise(resolve => setImmediate(resolve));
test("t", async () => {
  let settle, calls = 0, said;
  vi.doMock("./part.cjs", () => new Promise(resolve => { calls++; settle = resolve; }));
  try { said = String(require("./part.cjs").x); } catch (error) { said = error.name; }
  vi.doUnmock("./part.cjs");
  console.log("SAID", (await import("./other.js")).y);
  settle({ x: "late mock" });
  await turn();
  console.log("SAID", said, calls, (await import("./part.cjs")).x);
  try { console.log("SAID", require("./part.cjs").x); } catch (error) { console.log("SAID", error.name); }
});
test("next", async () => console.log("SAID next", (await import("./part.cjs")).x));
