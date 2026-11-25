import { test, vi } from "bun:test";
const say = async (at, file) => { try { console.log("SAID", at, file, (await import("./" + file + ".mjs")).look(), "ran", globalThis.ran); } catch (error) { console.log("SAID", at, file, error.name, "ran", globalThis.ran); } };
test("t", async () => {
  vi.doMock("./shapes.mjs", original => ({ square: 30 }));
  vi.doMock("./tints.mjs", original => ({ blue: 30 }));
  await say("under", "space-far");
  await say("under", "named-far");
  vi.doUnmock("./shapes.mjs");
  vi.doUnmock("./tints.mjs");
  await say("old", "space-far");
  await say("old", "named-far");
  await say("fresh", "space-far2");
  await say("fresh", "named-far2");
  try { const file = await import("./tints.mjs"); console.log("SAID the file", String(file.blue), String(file.round), Object.keys(file).join("+")); } catch (error) { console.log("SAID the file", error.name); }
});
