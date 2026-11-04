type Options = { name: string; isExpected?: (e: unknown) => boolean };
const kept: Options[] = [];
function one(k: number): Options { let n = k; const o: Options = { name: "a", isExpected: e => { n++; return n > 1; } }; kept.push(o); return o; }
function two(): Options { const o: Options = { name: "b" }; kept.push(o); return o; }
const a = one(0), b = two();
let said: unknown;
try { said = b.isExpected!(1); } catch (e: any) { said = e.constructor.name; }
console.log(a.isExpected!(1), said, a.isExpected!(1));
