import { test, vi } from "bun:test";
let failures = 0, held, step;
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + String(e.message).replace(/\/\S*\//g, "").slice(0, 60); } };
test("the mocks are laid in turn", async () => {
  vi.doMock("./reel.mjs", () => ({ turns: "first" }));
  step = "1:";
  console.log(step, "held:", held ? await tried(() => held.reads()) : "none");
  console.log(step, "import:", await tried(async () => (await import("./reel.mjs")).turns));
  console.log(step, "require:", await tried(() => import.meta.require("./reel.mjs").turns));
  console.log(step, "the winder:", await tried(() => (held = import.meta.require("./winder.mjs")).reads()));
  vi.doMock("./reel.mjs", async () => { await 0; throw new Error("late failure " + ++failures); });
  step = "2:";
  console.log(step, "held:", held ? await tried(() => held.reads()) : "none");
  console.log(step, "the winder:", await tried(() => (held = import.meta.require("./winder.mjs")).reads()));
});
