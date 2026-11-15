// remainder read behindLoop method var on=list n=9 reaches
const out: any[] = [];
let hits = 0;
const when: number = JSON.parse("1");
function show(x: any): string { if (typeof x === "number") return Object.is(x, -0) ? "-0" : "n" + x; if (typeof x === "string") return JSON.stringify(x); if (x === null || x === undefined || typeof x === "function") return typeof x; if (Array.isArray(x)) return "[" + x.map(show).join(" ") + "]"; return x instanceof Error ? x.name : typeof x + JSON.stringify(x); }
function said(e: any): string { return e instanceof Error ? e.name : "!" + show(e); }
function step(): number { hits++; if (hits === when) throw 0; return hits; }
const texty: any = { toString() { step(); return "x"; }, valueOf() { step(); return 2; }, toJSON() { step(); return 1; } };
const made: any = [1, 5, 2, 3, 1, 5, 2, 3, 1];
const mild: number[] = [1, 5, 2, 3];
class Host { run(from: number, table: number[]): any {
  let got: any;
  var k = 1;
  try { for (let i = from | 0; i < -3; i++) { k = (i | 0) % 4; got = table[k]; got = texty + 1; } } catch (e: any) { out.push(said(e)); } out.push(Object.is(k, -0), 1 / k);
} }
const host = new Host();
try { out.push(host.run(-12, mild)); } catch (e: any) { out.push("escaped", said(e)); }
try { out.push(host.run(-12, made)); } catch (e: any) { out.push("escaped", said(e)); }
out.push(Object.keys(made).join(), Object.values(made));
out.push(Object.keys(mild).join(), Object.values(mild));
console.log(out.map(show).join(" "), hits);
export {};
