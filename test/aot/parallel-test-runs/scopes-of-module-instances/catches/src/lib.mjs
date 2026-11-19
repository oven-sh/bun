import { base } from "./dep.mjs";
export const fs = [];
try { throw new Error("e" + base); } catch (error) { fs.push(() => error.message, m => (error = new Error(m)).message); }
try { throw { a: 1 + base, b: [2, 3] }; } catch ({ a, b: [c, ...rest], d = a + c }) { fs.push(() => [a, c, rest, d].join()); class In { static x = a; get() { return In.x++ + d; } } fs.push(() => new In().get()); }
try { null.x; } catch { const n = "none" + base; fs.push(() => n); }
switch (typeof base) { case "number": { let deep = 1; { let deeper = deep + base; fs.push(() => deeper++); } } function f() { return g(); } function g() { return "g" + base; } fs.push(f); }
{ var hoistedVar = base * 3; let shadow = "inner"; { let shadow = "innermost"; fs.push(() => shadow); } fs.push(() => shadow + hoistedVar); }
{ async function later() { return inner + base; } const inner = "late"; fs.push(() => inner); globalThis.laterOf = later; }
let outer = "outer"; { fs.push(() => outer); outer = "changed"; let outer2 = outer; fs.push(() => outer2); }
export async function use() { const out = fs.map(f => String(f("again"))); out.push(await globalThis.laterOf()); return out.join(" "); }
