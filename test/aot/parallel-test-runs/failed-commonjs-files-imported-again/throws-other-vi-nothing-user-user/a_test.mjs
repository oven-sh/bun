import { mock, test, vi } from "bun:test";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
globalThis.R = [];
const say = (at, it) => console.log("SAID", at, it, globalThis.R.splice(0).join());
test("t", async () => {
  vi.doMock("./other.mjs", () => ({ v: 2 }));
  let it; try { it = (await import("./user.mjs")).v; } catch (e) { it = e.name; }
  say("first", it);
  
  try { it = (await import("./user.mjs")).v; } catch (e) { it = e.name; }
  say("second", it);
  try { it = (await import("./user.mjs")).v; } catch (e) { it = e.name; }
  say("third", it);
});
