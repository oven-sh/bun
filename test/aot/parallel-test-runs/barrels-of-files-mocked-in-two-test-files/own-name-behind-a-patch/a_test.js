import { mock, test } from "bun:test";
const say = (...w) => console.log("SAID", ...w), tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.name; } };
test("a", async () => {
  mock.module("./dep.cjs", () => ({ flag: "first", plain: "p" }));
  say("require", await tried(() => import.meta.require("./dep.cjs").flag));
  say("barrel", await tried(async () => (await import("./barrel.js")).flag));
  say("import", await tried(async () => (await import("./dep.cjs")).flag));
});
