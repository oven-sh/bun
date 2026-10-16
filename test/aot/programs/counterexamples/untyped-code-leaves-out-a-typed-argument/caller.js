import { Test, free, freeRest } from "./typed.ts";
function row(name, f) { try { console.log(name + ": " + f()) } catch (e) { console.log(name + ": THROWS " + String(e).split(" (bun")[0]) } }
row("a method", () => new Test().plain(() => "ran"));
row("a method with a rest parameter", () => new Test().rest(() => "ran"));
row("a function", () => free(() => "ran"));
row("a function with a rest parameter", () => freeRest(() => "ran"));
const t = new Test(), hidden = [t.plain, t.rest, free, freeRest];
for (const f of hidden) row("by value " + f.name, () => f.call(t, () => "ran"));
