const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function parse(text: string, reviver?: any): any {
  return JSON.parse(text, reviver);
}
interface Row { count: number; ok: boolean; name: string; tags: string[]; inner: { depth: number } }
function read(row: Row): string {
  return [typeof row.count, row.count, typeof row.ok, row.ok, typeof row.name, row.name, Array.isArray(row.tags), JSON.stringify(row.tags), JSON.stringify(row.inner)].join(" ");
}
function total(rows: Row[]): number {
  let sum = 0;
  for (const row of rows) sum += row.count;
  return sum;
}
function show(text: string) {
  const value = parse(text);
  console.log(read(value), JSON.stringify(value));
}
leak({ count: 0, ok: true, name: "", tags: [], inner: { depth: 0 } } satisfies Row);
const rows: Row[] = [];
for (let i = 0; i < 4; i++) rows.push({ count: i, ok: i % 2 === 0, name: `n${i}`, tags: [`t${i}`], inner: { depth: i } });
console.log(total(rows), read(rows[3]!));
const fits = '"ok":true,"name":"n","tags":["a"],"inner":{"depth":1}';
for (let round = 0; round < 3; round++) {
  for (const count of ["1", "-1", "0", "-0", "1.5", "1e3", "1e21", "2147483647", "2147483648", "-2147483648", "-2147483649", "9007199254740993", "1e400", "null", '"7"', "true", "[]", "{}"])
    show(`{"count":${count},${fits}}`);
  show('{"count":1,"ok":null,"name":"n","tags":["a"],"inner":{"depth":1}}');
  show('{"count":1,"ok":0,"name":"n","tags":["a"],"inner":{"depth":1}}');
  show('{"count":1,"ok":true,"name":null,"tags":["a"],"inner":{"depth":1}}');
  show('{"count":1,"ok":true,"name":5,"tags":["a"],"inner":{"depth":1}}');
  show('{"count":1,"ok":true,"name":"n","tags":{"0":"a"},"inner":{"depth":1}}');
  show('{"count":1,"ok":true,"name":"n","tags":[1,null,{}],"inner":{"depth":1}}');
  show('{"count":1,"ok":true,"name":"n","tags":null,"inner":null}');
  show('{"count":1,"ok":true,"name":"n","tags":["a"],"inner":{"depth":"deep"}}');
  show('{"count":1,"ok":true,"name":"n","tags":["a"],"inner":[1]}');
  show('{"count":1,"ok":true,"name":"n","tags":["a"],"inner":{"depth":1,"more":2}}');
  console.log(total(parse(`[{"count":1,${fits}},{"count":2.5,${fits}},{"count":"x",${fits}}]`)));
}
export {};
