import { test, vi } from "bun:test";
const say = async (at, file) => { try { console.log("SAID", at, file, (await import("./" + file + ".mjs")).look(), "ran", globalThis.ran); } catch (error) { console.log("SAID", at, file, error.name, "ran", globalThis.ran); } };
test("t", async () => {
  vi.doMock("./shapes.mjs", () => ({ square: 30 }));
  await say("under", "space-far");
  await say("under", "named-far");
  await say("under", "space-top");
});
