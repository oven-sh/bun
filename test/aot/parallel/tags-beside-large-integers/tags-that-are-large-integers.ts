interface Far { tag: -4611686018427387392; a: number } interface Low { tag: 512; b: number } interface Wide { tag: 4294967808; c: number } interface Edge { tag: 2147483647; d: number } interface Under { tag: -2147483648; e: number }
type Any = Far | Low | Wide | Edge | Under;
const make = (i: number): Any => i % 5 == 0 ? { tag: -4611686018427387392, a: i } : i % 5 == 1 ? { tag: 512, b: i } : i % 5 == 2 ? { tag: 4294967808, c: i } : i % 5 == 3 ? { tag: 2147483647, d: i } : { tag: -2147483648, e: i };
function cases(x: Any): string { switch (x.tag) { case 512: return "low" + x.b; case -4611686018427387392: return "far" + x.a; case 4294967808: return "wide" + x.c; case 2147483647: return "edge" + x.d; case -2147483648: return "under" + x.e; } }
function row(x: Any): string { if (x.tag === 4294967808) return "wide" + x.c; if (x.tag === 512) return "low" + x.b; if (x.tag === -4611686018427387392) return "far" + x.a; if (x.tag === -2147483648) return "under" + x.e; return "edge" + x.d; }
let out = ""; for (let i = 0; i < 11; i++) out += cases(make(i)) + ":" + row(make(i)) + " "; console.log(out);
