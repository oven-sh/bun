// Between the allocation and the store behind it nothing of the program runs: a getter that gives the next value, a throw in it, and a spread of the object see the values and never a filler.
let log = "";
function source(text: string): any { const x = JSON.parse(text); return { get a() { log += "a"; return x.a; }, get b() { log += "b"; if (x.fails) throw new Error("from b"); return x.b; }, get c() { log += "c"; return x.c; } }; }
function make(text: string) { const s = source(text); const o: { a: number; b: number; c: number } = { a: s.a, b: s.b, c: s.c }; return o; }
function tell(text: string) { log = ""; try { const o = make(text); const copy = { ...o }; return log + "|" + o.a + "," + o.b + "," + o.c + "|" + JSON.stringify(copy) + "|" + ("a" in o) + Object.entries(o).length; } catch (error) { return log + "|" + (error as Error).message; } }
for (const text of ['{"a":1,"b":2,"c":3}', '{"a":1.5,"b":"two","c":null}', '{"a":1,"fails":true}', '{"b":4294967296}']) console.log(tell(text));
function twice(text: string) { const x: any = JSON.parse(text); const first: { n: number; m: number } = { n: x, m: 1 }; const second: { n: number; m: number } = { n: first.n, m: first.m + 1 }; first.n = 0; return first.n + ":" + second.n + ":" + second.m + ":" + (first === second); }
for (const text of ["5", "7.5", '"t"', "null"]) console.log(twice(text));
