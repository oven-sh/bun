import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);
import { base } from "../src/dep.mjs";
globalThis.runs = (globalThis.runs ?? 0) + 1;
const run = globalThis.runs;
let state = run * 100 + base;
class Own { #x = run; static made = []; constructor() { Own.made.push(run); } get x() { return this.#x * 10 + state; } add(n) { this.#x += n; state++; return this.#x + run; } static who() { return Own.made.join("") + run; } has(o) { return #x in o; } }
{ const inBlock = run * 7; class Inner { static v = inBlock; get() { return Inner.v + inBlock; } } (globalThis.inners ??= []).push(() => new Inner().get()); }
const all = (globalThis.owns ??= []);
const fns = (globalThis.fns ??= []);
test("own", () => {
  all.push(new Own()); fns.push(n => n + run + state, () => Own.who());
  const out = [];
  for (const o of all) { try { out.push(o.x, o.add(1), o.x, all.map(p => o.has(p)).join("")); } catch (e) { out.push(e.constructor.name); } }
  let sum = 0; const mine = all[all.length - 1]; for (let i = 0; i < 5; i++) sum += mine.add(i) + mine.x;
  say(run, out.join(" "), "|", fns.map(f => f(1)).join(" "), "|", globalThis.inners.map(f => f()).join(" "), "|", sum, Own.who());
});
