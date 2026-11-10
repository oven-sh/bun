import { test } from "bun:test";
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + String(e.message).replace(/\/\S*\//g, "").slice(0, 60); } };
test("the next file looks", async () => {
  console.log("next: import:", await tried(async () => (await import("./reel.mjs")).turns));
  console.log("next: require:", await tried(() => import.meta.require("./reel.mjs").turns));
  console.log("next: the winder:", await tried(() => import.meta.require("./winder.mjs").reads()));
});
