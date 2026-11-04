// rows of one written type get their keys in other orders: written otherwise, deleted and added again, filled late, out of JSON.parse
// COUNT: operation:operationAOTStringBuilderBegin >= 1
type Row = { id: number; name: string; ok?: boolean };
function write(row: Row): string {
  return JSON.stringify(row);
}
for (let i = 0; i < 3; i++) console.log(write({ id: i, name: "n" + i, ok: true }));
console.log(write({ name: "first", id: 1 }));
console.log(write({ ok: false, name: "last", id: 2 }));
const again: Row = { id: 3, name: "gone", ok: true };
delete (again as any).id;
again.id = 33;
console.log(write(again));
const late: Row = { id: 4, name: "late" };
late.ok = true;
console.log(write(late));
console.log(write(JSON.parse('{"name":"parsed","ok":true,"id":5}')));
for (let i = 0; i < 4; i++) console.log(write(i % 2 ? { name: "odd", id: i } : { id: i, name: "even" }));
