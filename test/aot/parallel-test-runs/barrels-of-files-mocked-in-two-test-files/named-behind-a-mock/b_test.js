import { test, vi } from "bun:test";
import { flag } from "./barrel.js";
const say = (...w) => console.log("SAID", ...w), tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.name; } };
test("b", async () => {
  say("static", flag);
  say("require", await tried(() => import.meta.require("./dep.cjs").flag));
  vi.doMock("./dep.cjs", () => { say("factory"); throw new Error("boom"); });
  say("barrel", await tried(async () => (await import("./barrel.js")).flag));
  say("import", await tried(async () => (await import("./dep.cjs")).flag));
  say("require", await tried(() => import.meta.require("./dep.cjs").flag));
  say("static", flag);
});
