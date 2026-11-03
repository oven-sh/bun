// One argument fits an interface and the other is an instance of a built in class.
type HasLength = { length: number };

function same(a: HasLength, b: HasLength): boolean {
  return a === b;
}

function compare(): boolean[] {
  return [same("ab", new String("ab")), same(["a"], "a"), same("ab", "ba")];
}

let warm = 0;
const one = { length: 1 };
for (let i = 0; i < 2000; i++) {
  const other = { length: 1 };
  warm += (same(one, one) ? 1 : 0) + (same(one, other) ? 1 : 0);
  if (i % 500 === 0) console.log(compare().join());
}
console.log("after 2000 pairs of objects", warm);
