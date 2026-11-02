// What a generic function makes from two spreads, or with Object.assign, is a copy with the layout of its first source, and the names that the second source brings get fields there: no type is opened for them.
// IR- ^layout (?!.*IsNeverAllocated)(?!.*impossibleMutations=\[[^\]]*AddProperty)
// IR- ^    v\d+: boolean = HasNoExtraProperties
interface Named {
  name: string;
}
interface Point extends Named {
  x: number;
}
interface Span extends Named {
  from: number;
}
function merge<T extends Named, U extends object>(first: T, second: U): T & U {
  return { ...first, ...second };
}
function assign<T extends Named, U extends object>(first: T, second: U): T & U {
  return Object.assign({}, first, second);
}
for (let round = 0; round < 3; round++) {
  const point: Point = { name: "p", x: round };
  const span: Span = { name: "s", from: round };
  const merged = merge<Point, { at: number }>(point, { at: round + 1 });
  const assigned = assign<Span, { to: number; name: string }>(span, { to: round + 2, name: "t" });
  merged.at += 10;
  console.log(merged.name, merged.x, merged.at, Object.keys(merged).join(), JSON.stringify(merged));
  console.log(assigned.name, assigned.from, assigned.to, Object.keys(assigned).join(), JSON.stringify(assigned));
  console.log(
    Object.keys(point).join(),
    "at" in point,
    JSON.stringify(point),
    Object.keys(span).join(),
    "to" in span,
    JSON.stringify(span),
  );
}
