// Bun.deepMatch(subset, value) hands has() of a Proxy around a Set a member that the value holds two steps down: the Proxy and the Set of the value are each under a property. has() writes the member, and the caller reads it in front of the call and behind it.
class Row {
  x: number = 1;
}
let calls = 0;
// A Proxy without traps calls each method on itself, so none of them may ask the Set below.
class Served extends Set<Row> {
  get size(): number {
    return 1;
  }
  has(row: Row): boolean {
    calls++;
    row.x = 2;
    return true;
  }
  [Symbol.iterator](): SetIterator<Row> {
    return ([] as Row[])[Symbol.iterator]() as unknown as SetIterator<Row>;
  }
}
function run(): (number | boolean)[] {
  const row = new Row();
  const before = row.x;
  const matched = Bun.deepMatch({ rows: new Proxy(new Served(), {}) }, { rows: new Set<Row>([row]), other: 1 });
  return [before, matched, row.x, calls];
}
for (let turn = 0; turn < 3; turn++) console.log(JSON.stringify(run()));
