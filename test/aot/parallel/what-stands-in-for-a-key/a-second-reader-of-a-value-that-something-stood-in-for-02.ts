// forInJson write asyncCatch function outer on=proxy n=9 reaches
const out: any[] = [];
let hits = 0;
function show(x: any): string { if (typeof x === "number") return Object.is(x, -0) ? "-0" : "n" + x; if (typeof x === "string") return JSON.stringify(x); if (x === null || x === undefined || typeof x === "function") return typeof x; if (Array.isArray(x)) return "[" + x.map(show).join(" ") + "]"; return x instanceof Error ? x.name : typeof x + JSON.stringify(x); }
function said(e: any): string { return e instanceof Error ? e.name : "!" + show(e); }
function step(): number { hits++; if (hits === 2 && input.length > 2) input.pop(); if (hits === 3) throw undefined; return hits; }
const input: any[] = JSON.parse("[7, 8, 9, 10, 11, 12, 13, 14, 15]");
const made: any = new Proxy({} as any, { get(o: any, p: any): any { out.push(p); step(); return 4; }, set(o: any, p: any, w: any) { out.push(p, w); step(); return true; }, has(o: any, p: any) { out.push(p); return step() % 2 === 0; }, deleteProperty(o: any, p: any) { out.push(p); step(); return true; }, defineProperty(o: any, p: any) { out.push(p); step(); return true; } });
async function run(list: any[], store: any): Promise<any> {
  let got: any;
  let k = "none";
  for (let round = 0; round < 2; round++) { try { for (k in list) { got = await (store[k] = 5); } } catch (e: any) { out.push(said(e), typeof k, JSON.stringify(k)); } }
}
try { out.push(await run(input, made)); } catch (e: any) { out.push("escaped", said(e)); }
console.log(out.map(show).join(" "), hits);
export {};
