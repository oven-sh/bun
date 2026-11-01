// What a generic function makes with a spread of its parameter and names of its own is a copy with the layout of what arrives, and the names that the literal writes get fields there: no type is opened for them.
// IR- ^layout (?!.*IsNeverAllocated)(?!.*impossibleMutations=\[[^\]]*AddProperty)
// IR- ^    v\d+: boolean = HasNoExtraProperties
interface Named {
  name: string;
}
interface Point extends Named {
  x: number;
  y: number;
}
interface Span extends Named {
  from: number;
}
function tag<T extends Named>(value: T, id: number): T & { id: number; seen: boolean } {
  return { ...value, id, seen: false };
}
function rename<T extends Named>(value: T): T {
  return { ...value, name: "renamed" };
}
let sum = 0;
for (let round = 0; round < 3; round++) {
  const point: Point = { name: "p", x: round, y: 2 };
  const span: Span = { name: "s", from: round };
  const p = tag<Point>(point, round);
  const s = tag<Span>(span, round + 10);
  p.seen = true;
  sum += p.id + s.id + p.x + s.from;
  console.log(p.name, p.x, p.y, p.id, p.seen, Object.keys(p).join(), JSON.stringify(s), "id" in s);
  console.log(
    Object.keys(point).join(),
    "id" in point,
    (span as { id?: number }).id,
    JSON.stringify(span),
    JSON.stringify(rename(s)),
    JSON.stringify(tag(p, 7)),
  );
}
console.log(sum);
