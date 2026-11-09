interface Low { tag: 512; a: number } interface One { tag: 1; b: number } interface Two { tag: 2; c: number } interface Seven { tag: 7; d: number }
type Any = Low | One | Two | Seven;
const make = (i: number): Any => i % 4 == 0 ? { tag: 512, a: i } : i % 4 == 1 ? { tag: 1, b: i } : i % 4 == 2 ? { tag: 2, c: i } : { tag: 7, d: i };
function cases(x: Any): string { switch (x.tag as number) { case -4611686018427387392: return "huge"; case 512: return "low"; case 1: return "one"; case 2: return "two"; default: return "rest"; } }
function mirrored(x: Any): string { switch (x.tag as number) { case 512: return "low"; case -4611686018427387392: return "huge"; case 4611686018427386881: return "huge too"; case 1: return "one"; default: return "rest"; } }
function row(x: Any): string { if ((x.tag as number) === -4611686018427387392) return "huge"; if (x.tag === 512) return "low" + x.a; if (x.tag === 1) return "one" + x.b; if (x.tag === 2) return "two" + x.c; return "rest" + x.d; }
function lone(x: Any): boolean { return (x.tag as number) === -4611686018427387392; }
function above(x: Any): boolean { return (x.tag as number) === 4294967808 || (x.tag as number) === 1099511628288; }
let out = ""; for (let i = 0; i < 9; i++) out += cases(make(i)) + ":" + mirrored(make(i)) + ":" + row(make(i)) + ":" + lone(make(i)) + ":" + above(make(i)) + " "; console.log(out);
