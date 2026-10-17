// Many objects of one shape come out of JSON.parse with properties that their type does not declare: ahead of the declared ones, among
// them and behind them. Each stays one object: the extra properties are read, written, removed and listed as in any object, and
// the keys keep their order.
interface Inner { r: number }
interface Row { id: number; name: string; inner: Inner; done: boolean }
const made: Row = { id: 0, name: "made", inner: { r: 0 }, done: true };
function use(row: Row): string {
  row.id += 1;
  row.inner.r += 1;
  return row.id + row.name + row.inner.r + row.done;
}
const shapes = [
  (i: number) => '{"first":' + i + ',"id":' + i + ',"name":"a","inner":{"r":1},"done":false}',
  (i: number) => '{"id":' + i + ',"middle":"m' + i + '","name":"b","inner":{"r":2},"done":true}',
  (i: number) => '{"id":' + i + ',"name":"c","inner":{"r":3},"done":false,"last":[' + i + ']}',
  (i: number) => '{"x":null,"id":' + i + ',"y":{"z":' + i + '},"name":"d","inner":{"r":4,"more":' + i + '},"done":true,"w":"w"}',
];
console.log(use(made));
const kept: any[] = [];
for (let i = 0; i < 4; i++) {
  for (const shape of shapes) {
    const raw: any = JSON.parse(shape(i));
    kept.push(raw);
    console.log(use(raw), Object.keys(raw).join(), JSON.stringify(raw));
  }
}
for (const raw of kept) {
  const row: Row = raw;
  raw.added = row.id;
  delete raw.middle;
  delete raw.x;
  if ("last" in raw) raw.last.push(row.name);
  if ("first" in raw) raw.first *= 2;
  console.log(row === raw, use(row), Object.keys(raw).join(), JSON.stringify(raw), Object.entries(raw).length);
}
