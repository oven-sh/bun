import { test, vi } from "bun:test";
import { seen } from "./lamp.mjs";
let calls = 0;
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
test("a", async () => {
  delete require.cache[require.resolve("./lamp.mjs")];
  vi.doMock("./wick.mjs", async () => { calls++; await new Promise(() => {}); });
  console.log(seen, "|", asked("./both.mjs"), "|", asked("./lamp.mjs"), "|", calls, "|", globalThis.lamps);
});
