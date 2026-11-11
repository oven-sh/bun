// forInJson callSelf returned method outer on=accessors n=3 reaches
const out: any[] = [];
let hits = 0;
function show(x: any): string { if (typeof x === "number") return Object.is(x, -0) ? "-0" : "n" + x; if (typeof x === "string") return JSON.stringify(x); if (x === null || x === undefined || typeof x === "function") return typeof x; if (Array.isArray(x)) return "[" + x.map(show).join(" ") + "]"; return x instanceof Error ? x.name : typeof x + JSON.stringify(x); }
function said(e: any): string { return e instanceof Error ? e.name : "!" + show(e); }
function step(): number { hits++; if (hits === 1) throw new RangeError("r"); return hits; }
function member(...values: any[]): any { out.push(values[values.length - 1]); step(); return values.length; }
const made: any = { get "0"(): any { return member; }, set "0"(w: any) { out.push(w); step(); }, get "1"(): any { return member; }, set "1"(w: any) { out.push(w); step(); }, get "2"(): any { return member; }, set "2"(w: any) { out.push(w); step(); } };
class Host { run(list: any[], store: any): any {
  let got: any;
  let turns = 0;
  let key: any = undefined;
  try { for (key in list) { const same = key; got = store[key](key); out.push(same === key); step(); if (++turns === 2) return key; } } catch (e: any) { return key; } finally { out.push(typeof key); } return "end";
} }
const host = new Host();
try { out.push(host.run(JSON.parse("[7, 8, 9]"), made)); } catch (e: any) { out.push("escaped", said(e)); }
console.log(out.map(show).join(" "), hits);
export {};
