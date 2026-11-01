// Two lists get an element far past their end, which makes their storage sparse. One is then walked with for-of, the other read with at(). Both functions are called through a table.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
declare const console: { log(...values: unknown[]): void };
const show = (v: any, d = 0): string => { if (v === null) return "null"; if (v === undefined) return "u"; const t = typeof v; if (t === "number") return Object.is(v, -0) ? "-0" : String(v); if (t === "string") return JSON.stringify(v); if (t === "function") return "fn"; if (t === "symbol") return "sym"; if (t !== "object") return String(v); if (d > 2) return ".."; if (Array.isArray(v)) { const p = []; for (let i = 0; i < Math.min(v.length, 30); i++) { const e = Object.getOwnPropertyDescriptor(v, i); p.push(!e ? "_" : "value" in e ? show(e.value, d + 1) : "<acc>"); } const names = Reflect.ownKeys(v).filter(k => typeof k === "symbol" || (k !== "length" && !/^\d+$/.test(k))).map(String).join(); return "[" + p.join() + "]" + v.length + (names ? "{" + names + "}" : "") + (Object.getPrototypeOf(v) === Array.prototype ? "" : "P") + (Object.isExtensible(v) ? "" : "X"); } if (v instanceof Set) return "Set" + show([...v], d + 1); if (typeof v.next === "function") return "iter"; if (typeof v.then === "function") return "thenable"; return "{" + Object.keys(v).map(k => k + ":" + show(v[k], d + 1)).join() + "}"; };
const recs = [{ id: 0 }, { id: 1 }, { id: 2 }];
class Mine extends Array { map(...a: any[]): any { return "Mine.map"; } }
class Plain extends Array {}
function rest(...r: any[]) { return r; }
const attempt = (f: () => unknown): string => { try { return show(f()); } catch (e) { return "THROWS " + (e as Error).name; } };
function hidden(a: any, f: (a: any) => void) { f(a); }
const said: string[] = [];
function g3049() { const a: any = [...[8, 9]]; a[5000] = "far"; return (() => { const r = []; for (const x of a) r.push(x); return r; })(); }
function g3065() { const a: any = Object.keys({ k: 1 }); a[5000] = "far"; return a.at(0); }
const ALL: [string, () => unknown][] = [["sparse | (() => { const r = []; for (const x of a) r.push(x); return r; })() | [...[8, 9]] | form 0", g3049], ["sparse | a.at(0) | Object.keys({ k: 1 }) | form 0", g3065]];
for (let turn = 0; turn < 3; turn++) for (const [name, f] of ALL) { const r = attempt(f); if (turn !== 1) console.log(turn + " " + name + ": " + r); }
