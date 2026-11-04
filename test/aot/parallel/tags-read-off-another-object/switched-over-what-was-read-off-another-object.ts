type Amber = { kind: string; v: number; a: number };
type Birch = { kind: string; v: string; b: number };
type Circle = { kind: "circle"; r: number };
type Square = { kind: "square"; s: number };
type Dot = { kind: "dot"; d: number };
function side(x: Circle | Square | Dot): number { switch (x.kind) { case "circle": return x.r; case "square": return x.s; default: return x.d; } }
function probe(o: Amber | Birch, from: Circle | Square | Dot): string {
  o.kind = from.kind;
  switch (o.kind) {
    case "circle": return "c:" + typeof o.v + ":" + ("a" in o);
    case "square": return "s:" + typeof o.v + ":" + ("a" in o);
    case "dot": return "d:" + typeof o.v + ":" + ("a" in o);
    default: return "?:" + typeof o.v;
  }
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
