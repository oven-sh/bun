import { test, vi } from "bun:test";
const turn = () => new Promise(resolve => setImmediate(resolve));
test("t", async () => {
  let settle, calls = 0, said;
  vi.doMock("./part.js", () => new Promise(resolve => { calls++; settle = resolve; }));
  try { said = String(require("./part.js").x); } catch (error) { said = error.name; }
  
  console.log("SAID", (await import("./other.js")).y);
  settle({ x: "late mock" });
  await turn();
  console.log("SAID", said, calls, (await import("./part.js")).x);
  try { console.log("SAID", require("./part.js").x); } catch (error) { console.log("SAID", error.name); }
});
test("next", async () => console.log("SAID next", (await import("./part.js")).x));
