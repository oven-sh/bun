// A round through the language: call apply bind. It prints what plain Bun prints.
type P = { x: number; y: number };
function show(label: string, f: () => unknown) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as any)?.name ?? String(e)); }
}
function sum(p: P, n: number): number { return p.x + p.y + n; }
function len(s: string): number { return s.length; }
function twice(n: number): number { return n * 2; }
const anySum: any = sum, anyLen: any = len, anyTwice: any = twice;
show("typed", () => sum({ x: 1, y: 2 }, 3));
show("any-1", () => anySum("str", {}));
show("any-2", () => anySum({ x: "a", y: [] }, "z"));
show("any-3", () => anySum({ y: 1 }, 2));
show("call", () => sum.call(null, 5 as any, "q" as any));
show("apply", () => sum.apply(null, [{ x: {}, y: 1 }, null] as any));
show("reflect", () => Reflect.apply(sum, undefined, [{ x: 1.5, y: "2" }, 3n]));
show("bind-1", () => (sum.bind(null, { x: "b", y: "c" } as any) as any)("d"));
show("bind-2", () => (anySum.bind(null))("s", 1));
show("len-1", () => anyLen(12));
show("len-2", () => anyLen({ length: "seven" }));
show("len-3", () => anyLen([1, 2, 3]));
show("len-4", () => len.call(null, (() => 1) as any));
show("twice-1", () => anyTwice("4"));
show("twice-2", () => anyTwice({ valueOf() { return 21; } }));
show("twice-3", () => anyTwice(undefined));
show("twice-4", () => anyTwice());
show("twice-5", () => anyTwice(10n));
for (let i = 0; i < 3; i++) show("loop" + i, () => anySum(i & 1 ? { x: 1, y: 2 } : { x: "1", y: 2 }, i));
