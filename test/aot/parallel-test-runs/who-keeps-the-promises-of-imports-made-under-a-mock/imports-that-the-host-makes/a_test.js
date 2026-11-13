import { test, vi } from "bun:test";
import { heat } from "./hearth.mjs";
const later = ms => new Promise(done => setTimeout(done, ms));
test("settled imports are let go", async () => {
  vi.doMock("./hearth.mjs", () => ({ heat: 2 }));
  const mocked = await import("./hearth.mjs");
  const seen = [];
  const ask = async () => {
    const asked = vi.importActual("./bellows.mjs");
    seen.push(new WeakRef(asked));
    await asked;
  };
  for (let n = 0; n < 200; n++) await ask();
  for (let n = 0; n < 5; n++) {
    await later(5);
    Bun.gc(true);
  }
  const alive = seen.filter(each => each.deref() !== undefined).length;
  console.log("SAID", heat, mocked.heat, seen.length, alive > 100 ? "most are kept" : "most are let go");
}, 20000);
