type Circle = { kind: "circle"; r: number };
type Square = { kind: "square"; s: number };
type Box = { label: string; inner: Circle | Square };
function probe(a: Circle | Square, box: Box): string {
  box.label = a.kind;
  const b = box.inner;
  if (box.label === "circle") return "c:" + a.kind + ":" + b.kind + ":" + ("r" in b);
  return "s:" + a.kind + ":" + b.kind + ":" + ("r" in b);
}
const seen: string[] = [];
for (let i = 0; i < 400; i++) {
  const a: Circle | Square = i % 2 ? { kind: "circle", r: 2 } : { kind: "square", s: 3 };
  const inner: Circle | Square = i % 3 ? { kind: "circle", r: 5 } : { kind: "square", s: 6 };
  const got = probe(a, { label: "", inner });
  if (!seen.includes(got)) seen.push(got);
}
console.log(seen.sort().join(" "));
