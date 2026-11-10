import { vi, mock, test } from "bun:test";
let calls = 0;
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.message; } };
const say = (...words) => console.log("SAID " + words.join(" | ") + " | calls " + calls + " | runs " + String(globalThis.runs));
const first = () => vi.doMock("./dep.json", () => ({ default: { flag: "first" }, flag: "first" }));
const counts = () => vi.doMock("./dep.json", () => { calls++; return { default: { flag: "second" }, flag: "second" }; });
const throws = () => vi.doMock("./dep.json", () => { calls++; throw new Error("sudden " + calls); });
const patches = () => mock.module("./dep.json", () => { calls++; return { default: { flag: "second" }, flag: "second" }; });
const R = () => tried(() => import.meta.require("./user.js").seen());
const C = () => tried(() => import.meta.require("./user.cjs").seen());
const U = () => tried(async () => (await import("./user.js")).seen());
const M = () => tried(async () => { const it = await import("./dep.json"); return it.flag ?? it.default.flag; });
test("a", async () => {
  first();
  say("R", await R());
  try { throws(); say("the second call returned"); } catch (e) { say("the second call threw " + e.message); }
  say("M", await M());
  say("R", await R());
  vi.doUnmock("./dep.json");
  say("after M", await M());
  say("after R", await R());
});
