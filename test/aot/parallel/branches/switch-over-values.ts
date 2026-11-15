// Switches and chains of comparisons whose cases are no literals: each case, none, twice the same, values that equal nothing.
const Add = Symbol("Add"), Sub = Symbol("Sub"), Mul = Symbol("Mul"), Div = Symbol("Div"), Nop = Symbol("Nop");
const One = { id: 1 }, Two = { id: 2 }, Three = { id: 3 };
let first: any = 1, second: any = "two", third: any = NaN, fourth: any = -0, fifth: any = 5n;
function symbols(op: any, a: number, b: number): any {
  switch (op) {
    case Nop: return "nop";
    case Add: return a + b;
    case Sub: return a - b;
    case Mul: { const product = a * b; if (product > 100) return "much"; return product; }
    case Div: a = a / b;
    default: return a;
  }
}
function objects(o: any): string {
  switch (o) { case One: return "one"; case Two: case Three: return "more"; default: return typeof o; }
}
function variables(v: any): string {
  switch (v) {
    case first: return "first";
    case second: return "second";
    case third: return "third";
    case fourth: return "fourth";
    case fifth: return "fifth";
    case first: return "never";
  }
  return "none";
}
function chain(v: any, a: any, b: any, c: any): number {
  if (v === a) return 1;
  else if (v === b) return 2;
  else if (v !== c) return 3;
  return 4;
}
function loose(v: any, a: any, b: any): number { if (v == a) return 1; if (v == b) return 2; if (b != v) return 3; return 4; }
function texts(v: any): number { if (v === "alpha") return 1; if (v === "beta") return 2; if (v === "gamma") return 3; return 0; }
function kinds(v: any): number { let n = 0; for (let i = 0; i < 3; i++) { switch (v) { case Add: n += 1; break; case Sub: n += 10; continue; case One: n += 100; break; default: n += 1000; } n += 5; } return n; }
const asked: any[] = [Nop, Add, Sub, Mul, Div, One, Two, Three, 1, "two", "t" + "wo", NaN, -0, 0, 5n, BigInt(5), null, undefined, "", "1", true, "alpha", ["be", "ta"].join(""), "gamma", new String("two"), [1]];
const out: any[] = [];
for (const v of asked) {
  out.push(symbols(v, 12, 4), symbols(v, 120, 4), objects(v), variables(v), texts(v), kinds(v));
  for (const a of asked) { out.push(chain(v, a, 1, "two"), chain(v, NaN, a, a)); if (typeof v !== "symbol" && typeof a !== "symbol") out.push(loose(v, a, 0), loose(a, v, undefined)); }
}
first = Add; second = Two; third = null; fourth = undefined; fifth = "alpha";
for (const v of asked) out.push(variables(v));
let hash = 0;
for (const v of out) { const t = Object.is(v, -0) ? "-0" : String(v); for (let i = 0; i < t.length; i++) hash = (Math.imul(hash, 31) + t.charCodeAt(i)) | 0; }
console.log(out.length, hash, out.slice(0, 60).join(" "));
