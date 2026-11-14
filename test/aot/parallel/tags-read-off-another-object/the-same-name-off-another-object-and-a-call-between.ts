type Amber = { kind: string; v: number; a: number };
type Birch = { kind: string; v: string; b: number };
type Circle = { kind: "circle"; r: number };
type Square = { kind: "square"; s: number };
type Dot = { kind: "dot"; d: number };
function side(x: Circle | Square | Dot): number { if (x.kind === "circle") return x.r; if (x.kind === "square") return x.s; return x.d; }
let held: Amber | Birch | undefined, turn = 0;
function meddle(): void { if (held && turn++ % 2) held.kind = "square"; }
function probe(o: Amber | Birch, from: Circle | Square | Dot): string {
  held = o;
  o.kind = from.kind;
  if (o.kind === "circle") return "c:" + typeof o.v;
  meddle();
  if (o.kind === "square") return "s:" + typeof o.v + ":" + from.kind;
  meddle();
  if (o.kind === "dot") return "d:" + typeof o.v + ":" + from.kind;
  return "?:" + o.kind + ":" + from.kind;
}
const seen: string[] = [];
let sides = 0;
for (let i = 0; i < 600; i++) {
  const o: Amber | Birch = i % 2 ? { kind: "k", v: i, a: 1 } : { kind: "k", v: "s", b: 2 };
  const from: Circle | Square | Dot = i % 3 == 0 ? { kind: "circle", r: 2 } : i % 3 == 1 ? { kind: "square", s: 3 } : { kind: "dot", d: 4 };
  sides += side(from);
  const got = probe(o, from);
  if (!seen.includes(got)) seen.push(got);
}
console.log(sides, seen.sort().join(" "));
