import { test, vi } from "bun:test";
let failures = 0;
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + String(e.message).slice(0, 22); } };
test("the mocks are laid in turn", async () => {
  vi.doMock("./reel.mjs", () => ({ turns: "first" }));
  console.log("1: import:", await tried(async () => (await import("./reel.mjs")).turns));
  console.log("1: require:", await tried(() => import.meta.require("./reel.mjs").turns));
  console.log("1: the winder:", await tried(() => import.meta.require("./winder.mjs").reads()));
  vi.doMock("./reel.mjs", async () => { await 0; throw new Error("late failure " + ++failures); });
  console.log("2: require:", await tried(() => import.meta.require("./reel.mjs").turns));
  console.log("2: the winder:", await tried(() => import.meta.require("./winder.mjs").reads()));
});
