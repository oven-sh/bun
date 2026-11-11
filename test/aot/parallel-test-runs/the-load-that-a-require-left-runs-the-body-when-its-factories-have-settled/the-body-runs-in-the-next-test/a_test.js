import { test, vi } from "bun:test";
const rest = time => new Promise(done => setTimeout(done, time));
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await rest(10); return { width: "mocked" }; });
  console.log(asked("./lamp.mjs"));
});
test("b", async () => {
  await rest(40);
  console.log("the end", globalThis.bodies ?? 0);
});
