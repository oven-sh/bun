import { test, vi } from "bun:test";
const rest = time => new Promise(done => setTimeout(done, time));
const say = (name, get) => { try { console.log("SAID " + name + " " + get()); } catch (error) { console.log("SAID " + name + " " + error.name); } };
test("b", async () => {
  let taken;
  vi.doMock("./lib.mjs", async original => { taken = await original(); return { ...taken, extra: "more" }; });
  const lib = await import("./lib.mjs");
  say("extra", () => lib.extra);
  say("value", () => lib.value);
  say("read", () => taken.read());
}, 8000);
