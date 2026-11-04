type Amber = { kind: string; v: number; a: number };
type Birch = { kind: string; v: string; b: number };
type Circle = { kind: "circle"; r: number };
type Square = { kind: "square"; s: number };
function side(x: Circle | Square): number { return x.kind === "circle" ? x.r : x.s; }
function probe(o: Amber | Birch, from: Circle | Square): string {
  o.kind = from.kind;
  if (o.kind === "circle") return "c:" + typeof o.v + ":" + ("a" in o) + ":" + ("r" in o);
  return "s:" + typeof o.v + ":" + ("a" in o) + ":" + ("s" in o);
}
const seen: string[] = [];
let sides = 0;
for (let i = 0; i < 400; i++) {
  const o: Amber | Birch = i % 2 ? { kind: "k", v: i, a: 1 } : { kind: "k", v: "s", b: 2 };
  const from: Circle | Square = i % 3 ? { kind: "circle", r: 2 } : { kind: "square", s: 3 };
  sides += side(from);
  const got = probe(o, from);
  if (!seen.includes(got)) seen.push(got);
}
console.log(sides, seen.sort().join(" "));
