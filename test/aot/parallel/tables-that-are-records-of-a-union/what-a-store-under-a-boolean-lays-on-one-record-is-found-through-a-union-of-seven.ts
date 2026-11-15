interface B { kind: string; y: string }
interface A { kind: string; a: number }
interface C { kind: string; c: number }
interface D { kind: string; d: number }
interface E { kind: string; e: number }
interface F { kind: string; f: number }
interface G { kind: string; g: number }
interface Item { v: number }
function makeB(n: number): B { return { kind: "b", y: "t" }; }
function makeA(n: number): A { return { kind: "a", a: n }; }
function makeC(n: number): C { return { kind: "c", c: n }; }
function makeD(n: number): D { return { kind: "d", d: n }; }
function makeE(n: number): E { return { kind: "e", e: n }; }
function makeF(n: number): F { return { kind: "f", f: n }; }
function makeG(n: number): G { return { kind: "g", g: n }; }
function makeItem(n: number): Item { return { v: n }; }
function pick(n: number, b: B): B | A | C | D | E | F | G { switch (n) { case 10: return makeA(n); case 11: return makeC(n); case 12: return makeD(n); case 13: return makeE(n); case 14: return makeF(n); case 15: return makeG(n); default: return b; } }
function lay(b: B, n: number): void { (b as any)[(n > 2) as any] = makeItem(5); }
function read(value: B | A | C | D | E | F | G): unknown { return (value as any).true; }
function run(n: number): number { const b = makeB(n); lay(b, n); const found: any = read(pick(n, b)); return found ? found.v : -1; }
let total = 0;
for (let n = 0; n < 17; n++) total += run(n);
console.log(total);
