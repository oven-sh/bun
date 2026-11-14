import { test, vi } from "bun:test";
const say = async (at, file) => { try { console.log("SAID", at, file, (await import("./" + file + ".mjs")).look(), "ran", globalThis.ran); } catch (error) { console.log("SAID", at, file, error.name, "ran", globalThis.ran); } };
test("t", async () => {
  await say("plainly", "space-far");
  await say("plainly", "named-far");
});
