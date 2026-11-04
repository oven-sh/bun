type Amber = { kind: string; v: number; a: number };
type Birch = { kind: string; v: string; b: number };
type Circle = { kind: "circle"; r: number };
type Square = { kind: "square"; s: number };
type Dot = { kind: "dot"; d: number };
type Line = { kind: "line"; l: number };
type Shape = Circle | Square | Dot | Line;
function side(x: Shape): number { if (x.kind === "circle") return x.r; if (x.kind === "square") return x.s; if (x.kind === "dot") return x.d; return x.l; }
function probe(o: Amber | Birch, from: Shape): string {
  o.kind = from.kind;
  if (o.kind === "circle") return "c:" + typeof o.v + ":" + ("a" in o);
  if (o.kind === "square") return "s:" + typeof o.v + ":" + ("a" in o);
  if (o.kind === "dot") return "d:" + typeof o.v + ":" + ("a" in o);
  if (o.kind === "line") return "l:" + typeof o.v + ":" + ("a" in o);
  return "?:" + typeof o.v;
}
const makers: (() => Shape)[] = [() => ({ kind: "circle", r: 2 }), () => ({ kind: "square", s: 3 }), () => ({ kind: "dot", d: 4 }), () => ({ kind: "line", l: 5 })];
const seen: string[] = [];
let sides = 0;
for (let i = 0; i < 800; i++) {
  const o: Amber | Birch = i % 2 ? { kind: "k", v: i, a: 1 } : { kind: "k", v: "s", b: 2 };
  const from = makers[(i >> 1) % 4]();
  sides += side(from);
  const got = probe(o, from);
  if (!seen.includes(got)) seen.push(got);
}
console.log(sides, seen.sort().join(" "));
