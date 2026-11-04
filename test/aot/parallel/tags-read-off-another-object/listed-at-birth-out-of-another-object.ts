type Circle = { kind: "circle"; r: number };
type Square = { kind: "square"; s: number };
function side(x: Circle | Square): number { return x.kind === "circle" ? x.r : x.s; }
function probe(from: Circle | Square, flip: boolean): string {
  const o = flip ? { kind: from.kind, v: 1, a: 1 } : { kind: from.kind, v: "s", b: 2 };
  if (o.kind === "circle") return "c:" + typeof o.v + ":" + ("a" in o);
  return "s:" + typeof o.v + ":" + ("a" in o);
}
const seen: string[] = [];
let sides = 0;
for (let i = 0; i < 400; i++) {
  const from: Circle | Square = i % 3 ? { kind: "circle", r: 2 } : { kind: "square", s: 3 };
  sides += side(from);
  const got = probe(from, i % 2 == 0);
  if (!seen.includes(got)) seen.push(got);
}
console.log(sides, seen.sort().join(" "));
