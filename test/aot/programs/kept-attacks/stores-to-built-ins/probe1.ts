// Forms of stores and definitions as a large program has them. Which of them still go by name at Selected though the receiver has a layout?
function largeLiteral(i: number) { return { a0: i, a1: i, a2: i, a3: i, a4: i, a5: i, a6: i, a7: i, a8: i, a9: i, a10: i, a11: i, a12: i, a13: i, a14: i, a15: i, a16: i, a17: i, a18: i, a19: i, a20: i, a21: i, a22: i, a23: i, a24: i, a25: i, a26: i, a27: i, a28: i, a29: i, a30: i, a31: i, a32: i, a33: i, a34: i, a35: i, a36: i, a37: i, a38: i, a39: i, a40: i, a41: i, a42: i, a43: i, a44: i, a45: i, a46: i, a47: i }; }
function spreadInTheMiddle(o: { p: number }, i: number) { return { x: i, ...o, y: i, z: i }; }
type Later = { a: number; b?: number; c?: string };
function storedLater(i: number) { const t: Later = { a: i }; t.b = i; if (i & 1) t.c = "c"; return t; }
function conditional(i: number): Later { return { a: i, ...(i & 1 ? { b: i } : {}) }; }
const Kind: any = {};
Kind["One"] = "One"; Kind["Two"] = "Two"; Kind["Three"] = "Three";
export const table = {
  t0: { type: "array", description: "d0", items: { type: "string", min: 0 } },
  t1: { type: "array", description: "d1", items: { type: "string", min: 1 } },
  t2: { type: "array", description: "d2", items: { type: "string", min: 2 } },
  t3: { type: "array", description: "d3", items: { type: "string", min: 3 } },
  t4: { type: "array", description: "d4", items: { type: "string", min: 4 } },
  t5: { type: "array", description: "d5", items: { type: "string", min: 5 } },
  t6: { type: "array", description: "d6", items: { type: "string", min: 6 } },
  t7: { type: "array", description: "d7", items: { type: "string", min: 7 } },
  t8: { type: "array", description: "d8", items: { type: "string", min: 8 } },
  t9: { type: "array", description: "d9", items: { type: "string", min: 9 } },
  t10: { type: "array", description: "d10", items: { type: "string", min: 10 } },
  t11: { type: "array", description: "d11", items: { type: "string", min: 11 } }
};
class Plain { x; y; constructor(i: number) { this.x = i; this.y = i; } }
function Old(this: any, i: number) { this.p = i; this.q = i; }
function withMethods(i: number) { return { i, get twice() { return this.i * 2; }, run() { return this.i; }, after: i }; }
function computedThenNamed(k: string, i: number) { return { [k]: i, named: i }; }
function undefinedFields(i: number) { return { a: i, b: undefined, c: i & 1 ? i : undefined }; }
function shorthandOfOptionals(a?: number, b?: string) { return { a, b }; }
let sum = 0;
const rounds = Number(process.argv[2] ?? 5);
for (let i = 0; i < rounds; i++) {
  sum += largeLiteral(i).a47 + spreadInTheMiddle({ p: i }, i).z + (storedLater(i).b ?? 0) + (conditional(i).b ?? 0) + new Plain(i).y + new (Old as any)(i).q + withMethods(i).after + computedThenNamed("k" + i, i).named + undefinedFields(i).a + (shorthandOfOptionals(i).a ?? 0);
}
console.log(sum, Object.keys(Kind).length, Object.keys(table).length);
