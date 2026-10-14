// Wrappers that pass their arguments on with `h.apply(this, arguments)`, `h.apply(t, rest)` or `h(...rest)`, nested deeply and with garbage collections in between.
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
const rest: any = function (this: any, ...a: any[]) { return String(this) + "/" + a.length + ":" + a.map(String).join(); };
const fixed2: any = function (this: any, a: any, b: any) { return String(this) + "/" + String(a) + "," + String(b); };
const fixed10: any = function (this: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any) { return [a, b, c, d, e, f, g, h, i, j].map(String).join(); };
const mutates: any = function (this: any) { const n = arguments.length; for (let i = 0; i < n; i++) arguments[i] = "m"; arguments.length = 0; return "mutated " + n; };
const mutatesRest: any = function (...a: any[]) { const n = a.length; a.length = 0; a.push("x"); return "cleared " + n; };
const thrower: any = function (...a: any[]) { throw new RangeError("r" + a.length); };
class K { constructor(public v: any) {} }
const callees: [string, any][] = [["rest", rest], ["fixed2", fixed2], ["fixed10", fixed10], ["mutates", mutates], ["mutatesRest", mutatesRest], ["thrower", thrower], ["max", Math.max], ["bound", rest.bind("B", "b1")], ["class", K],
  ["notCallable", {}], ["undefined", undefined], ["proxy", new Proxy(rest, {})], ["ownApply", Object.assign(function () { return "body"; }, { apply(t: any, l: any) { return "own apply " + Array.isArray(l) + " " + l.length; } })]];
const lists: any[][] = [[], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [undefined, null], [{ toString() { return "o"; } }]];
const lines: string[] = [];
for (const wrap of ["viaApplyArguments", "viaApplyRest", "viaSpread", "viaSpreadAfterFirst", "readsAfter", "twice", "inLoop", "inHandler", "inCatch", "nested"]) {
  for (const [name, callee] of callees) {
    const w = m[wrap](callee);
    let line = wrap + " " + name + ":";
    for (const list of lists) { try { line += " " + String(w.call("T", ...list)); } catch (e: any) { line += " threw " + e.constructor.name; } }
    lines.push(line);
  }
}
for (const [name, callee] of callees) { const w = m.viaApplyOtherThis(callee, "O"); try { lines.push("other " + name + " " + w(1, 2) + " " + w()); } catch (e: any) { lines.push("other " + name + " threw " + e.constructor.name); } }
console.log(lines.join("\n"));
// Deep: the arguments of each level live in the frame below it.
{ let f: any = rest; for (let i = 0; i < 200; i++) f = m.viaSpread(m.viaApplyArguments(f)); console.log(f(1, 2, 3)); }
// Objects that only the arguments hold, with collections in between.
{ const churn: any = function (...a: any[]) { let junk: any[] = []; for (let i = 0; i < 20000; i++) junk = [junk.length, {}, i]; return a.map(String).join() + junk.length; }; const w = m.nested(churn);
  let s = 0; for (let i = 0; i < 30; i++) s += w({ toString() { return "a" + i; } }, [i], "s" + i).length; console.log(s); }
export {};
