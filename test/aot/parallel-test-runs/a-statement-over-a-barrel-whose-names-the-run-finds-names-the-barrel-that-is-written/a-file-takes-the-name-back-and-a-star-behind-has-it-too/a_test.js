import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  const say = async (what, load) => { try { console.log("SAID", what, String((await load()).look())); } catch (e) { console.log("SAID", what, e.name); } };
  await say("by name", () => import("./names.mjs"));
  await say("off the namespace", () => import("./spaces.mjs"));
});
