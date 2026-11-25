type Amber = { kind: string; v: number; a: number };
type Birch = { kind: string; v: string; b: number };
type Either = Amber | Birch;
type Source = { pad: string; v: string };
function probe(o: Either, src: Source): string {
  o.kind = src.v;
  if (o.kind === "x") return "x:" + typeof o.v + ":" + ("a" in o);
  return "y:" + typeof o.v + ":" + ("a" in o);
}
const pool: Either[] = [], sources: Source[] = [];
for (let i = 0; i < 400; i++) {
  pool.push(i % 2 ? { kind: "k", v: i, a: 1 } : { kind: "k", v: "s", b: 2 });
  sources.push(i % 3 ? { pad: "", v: "x" } : { pad: "", v: "y" });
}
const seen: string[] = [];
for (let i = 0; i < 400; i++) {
  const got = probe(pool[i], sources[i]);
  if (!seen.includes(got)) seen.push(got);
}
console.log(seen.sort().join(" "));
