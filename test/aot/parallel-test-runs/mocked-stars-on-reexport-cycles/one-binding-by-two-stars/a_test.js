import { test, vi } from "bun:test";
const say = async (at, file) => { try { console.log("SAID", at, file, (await import("./" + file + ".mjs")).look(), "ran", globalThis.ran); } catch (error) { console.log("SAID", at, file, error.name, "ran", globalThis.ran); } };
test("t", async () => {
  vi.doMock("./shapes.mjs", original => ({ square: 30 }));
  vi.doMock("./tints.mjs", original => ({ blue: 30 }));
  await say("under", "space-far");
  await say("under", "named-far");
});
