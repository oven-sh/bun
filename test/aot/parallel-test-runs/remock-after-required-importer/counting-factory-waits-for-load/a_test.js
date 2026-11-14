import { vi, mock, test } from "bun:test";
let calls = 0;
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.message; } };
const say = (...words) => console.log("SAID " + words.join(" | ") + " | calls " + calls + " | runs " + String(globalThis.runs));
const first = () => vi.doMock("./dep.js", () => ({ flag: "first" }));
const counts = () => vi.doMock("./dep.js", () => { calls++; return { flag: "second" }; });
const throws = () => vi.doMock("./dep.js", () => { calls++; throw new Error("sudden " + calls); });
const R = () => tried(() => import.meta.require("./user.js").seen());
const Q = () => tried(() => import.meta.require("./dep.js").flag);
const U = () => tried(async () => (await import("./user.js")).seen());
const M = () => tried(async () => (await import("./dep.js")).flag);
test("a", async () => {
  first();
  say("R", await R());
  try { counts(); say("the second call returned"); } catch (e) { say("the second call threw " + e.message); }
  say("M", await M());
  say("R", await R());
});
