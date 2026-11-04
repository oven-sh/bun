// a row is turned away behind members that are written already: its last member is a stranger. The builder goes back to the pool empty, so the next text begins with nothing of it
// COUNT: operation:operationAOTStringBuilderBegin >= 1
type Row = { id: number; name: string; last: number };
function write(row: Row): string {
  return JSON.stringify(row);
}
function writeOther(p: { x: number; y: number }): string {
  return JSON.stringify(p);
}
const good = (id: number): Row => ({ id, name: "written before the stranger", last: id });
const bad = (id: number): Row => ({ id, name: "written before the stranger", last: { toJSON: () => "stranger " + id } as any });
console.log(write(good(1)));
console.log(write(bad(2)));
console.log(write(good(3)));
console.log(writeOther({ x: 1, y: 2 }));
for (let i = 0; i < 6; i++) console.log(write(i % 2 ? bad(i) : good(i)), writeOther({ x: i, y: -i }));
try {
  write({ id: 1, name: "thrown away", last: 1n as any });
} catch (e) {
  console.log((e as Error).name);
}
console.log(write(good(9)), writeOther({ x: 9, y: 9 }));
