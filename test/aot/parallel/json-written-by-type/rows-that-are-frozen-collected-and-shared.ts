// frozen, sealed and closed rows are written like any other; one object stands in two members, which is no cycle; collections run between the making and the writing, and between two texts
// COUNT: operation:operationAOTStringBuilderBegin >= 1
type Inner = { n: number };
type Row = { id: number; left: Inner; right: Inner; name: string };
function write(row: Row): string {
  return JSON.stringify(row);
}
function make(id: number): Row {
  const shared: Inner = { n: id };
  return { id, left: shared, right: shared, name: "n" + id };
}
for (let i = 0; i < 3; i++) console.log(write(make(i)));
console.log(write(Object.freeze(make(4))), write(Object.seal(make(5))), write(Object.preventExtensions(make(6))));
const kept = make(7);
Bun.gc(true);
console.log(write(kept));
let total = 0;
for (let i = 0; i < 2000; i++) {
  total += write(make(i)).length;
  if (i % 500 === 0) Bun.gc(true);
}
console.log(total);
