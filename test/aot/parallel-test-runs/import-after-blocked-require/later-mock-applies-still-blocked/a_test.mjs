import { test, vi } from "bun:test";
const rest = time => new Promise(done => setTimeout(done, time));
const gate = Promise.withResolvers();
const shown = load => { try { return load(); } catch (error) { return "threw " + error.name; } };
test("a second mock is laid behind the refusal", async () => {
  vi.doMock("./pump.mjs", async () => { console.log("SAID the first factory is called"); await gate.promise; return { seen: "fake pump" }; });
  console.log("SAID 1 " + shown(() => require("./tank.mjs").show()));
  vi.doMock("./paint.mjs", () => { console.log("SAID the second factory is called"); return { shade: "fake paint" }; });
  const names = await Promise.race([import("./tank.mjs"), rest(400)]);
  console.log("SAID 2 " + (names === undefined ? "waits" : shown(() => names.show())));
  console.log("SAID 3 " + shown(() => require("./tank.mjs").show()));
  gate.resolve();
}, 8000);
