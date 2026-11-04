interface A { tag: 0; a: number } interface B { tag: 1; b: number } interface C { tag: 2; c: number } interface D { tag: 7; d: number }
type Any = A | B | C | D;
interface Yes { ok: true; value: number } interface No { ok: false; why: string }
const make = (i: number): Any => i % 4 == 0 ? { tag: 0, a: i } : i % 4 == 1 ? { tag: 1, b: i } : i % 4 == 2 ? { tag: 2, c: i } : { tag: 7, d: i };
const result = (i: number): Yes | No => i % 2 ? { ok: true, value: i } : { ok: false, why: "w" + i };
function row(x: Any): number { if (x.tag === 0) return x.a; if (x.tag === 1) return x.b + 10; if (x.tag === 2) return x.c + 20; return x.d + 30; }
function cases(x: Any): number { switch (x.tag) { case 7: return x.d; case 2: return x.c; case 1: return x.b; case 0: return x.a; } }
function less(x: Any): string { return x.tag < 2 ? "low" : x.tag === 2 ? "two" + x.c : "seven" + x.d; }
function open(r: Yes | No): string { if (r.ok) return "v" + r.value; return r.why; }
function strict(r: Yes | No): string { if (r.ok === true) return "v" + r.value; return r.ok === false ? r.why : "?"; }
let out = ""; for (let i = 0; i < 9; i++) out += row(make(i)) + ":" + cases(make(i)) + ":" + less(make(i)) + ":" + open(result(i)) + ":" + strict(result(i)) + " "; console.log(out);
