import { test, vi } from "bun:test";
const say = (...w) => console.log("SAID", ...w), tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.name; } };
test("a", async () => {
  vi.doMock("./dep.cjs", { spy: true });
  say("require", await tried(() => import.meta.require("./dep.cjs").flag));
  say("barrel", await tried(async () => (await import("./barrel.js")).flag));
  say("import", await tried(async () => (await import("./dep.cjs")).flag));
});
