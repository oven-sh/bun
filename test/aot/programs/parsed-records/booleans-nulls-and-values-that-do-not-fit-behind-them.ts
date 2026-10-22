// JSON.parse makes records whose fields are booleans, numbers of every width and texts that may be null. A value that its field does not take, behind values that theirs have taken, gives the record up; collections run in between and find every cell whole.
const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function parse(text: string): any {
  return JSON.parse(text);
}
interface Row { id: number; on: boolean; off: boolean; maybe: boolean | null; name: string | null; count: number | null; ratio: number; inner: { deep: boolean }; tags: string[]; last: boolean }
function read(row: Row): string {
  return [row.id, row.on, row.off, row.maybe, row.name, row.count, row.ratio, JSON.stringify(row.inner), JSON.stringify(row.tags), row.last, typeof row.on, typeof row.maybe, row.on ? 1 : 0, row.off === false, row.maybe === null, Object.keys(row).join("")].join(" ");
}
leak({ id: 0, on: true, off: false, maybe: null, name: null, count: null, ratio: 0.5, inner: { deep: true }, tags: [], last: true } satisfies Row);
console.log(read({ id: 1, on: false, off: true, maybe: true, name: "n", count: 1, ratio: 1, inner: { deep: false }, tags: ["t"], last: false }));

const fitting: Record<string, string> = { id: "7", on: "true", off: "false", maybe: "null", name: '"n"', count: "3", ratio: "0.25", inner: '{"deep":true}', tags: '["a","b"]', last: "false" };
const odd = ["null", "true", "0", "1.5", '"text"', "[]", "{}", "[true]", '{"deep":1}', "-0", "1e400", "2147483648"];
const textWith = (changed: string, value: string) => `{${Object.keys(fitting).map(key => `"${key}":${key === changed ? value : fitting[key]}`).join(",")}}`;
const lines: string[] = [];
const kept: unknown[] = [];
for (let round = 0; round < 3; round++) {
  lines.push(read(parse(textWith("", ""))));
  for (const key of Object.keys(fitting)) {
    for (const value of odd) {
      const row = parse(textWith(key, value));
      kept.push(row);
      lines.push(`${key} ${value}: ${read(row)}`);
    }
    Bun.gc(true);
  }
  const many = parse(`[${Array.from({ length: 200 }, (_, index) => textWith(index % 7 === 3 ? "last" : index % 7 === 5 ? "off" : "id", index % 7 === 3 ? '"no"' : index % 7 === 5 ? "null" : String(index))).join(",")}]`) as Row[];
  Bun.gc(true);
  lines.push(many.map(row => `${row.id}${row.on}${row.off}${row.last}`).join("|"));
}
console.log(lines.join("\n"));
console.log(kept.length, JSON.stringify(kept[kept.length - 1]));
export {};
