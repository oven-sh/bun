// add, has, a walk, and the set methods.
// Sizes: 250 1000 4000
// Passes: 680
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);

function once(): string {
  const names = new Set<string>(),
    things = new Set<object>(),
    kept: object[] = [];
  for (let i = 0; i < size * 3; i++) {
    names.add("n" + (i % size));
    const thing = { i };
    things.add(thing);
    if ((i & 3) === 0) kept.push(thing);
  }
  let hits = 0;
  for (const thing of kept) if (things.has(thing)) hits++;
  let length = 0;
  for (const name of names) length += name.length;
  return [names.size, things.size, hits, length, names.union(new Set(["x"])).size].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
