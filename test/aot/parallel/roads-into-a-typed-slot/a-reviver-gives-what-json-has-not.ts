// records out of JSON.parse with written types; the reviver hands back what no text of JSON holds: a symbol, undefined, a big integer, a function, an object of a class
interface Row { id: number; name: string | null; tags: string[]; inner: { n: number } | null }
class Odd { n = 5; }
const text = '[{"id":1,"name":"a","tags":["x"],"inner":{"n":1}},{"id":2,"name":null,"tags":[],"inner":null},{"id":3,"name":"c","tags":["y","z"],"inner":{"n":3}}]';
const gives: Array<[string, (v: any) => any]> = [["id", () => Symbol.iterator], ["id", () => undefined], ["id", () => 3n], ["name", () => undefined], ["name", () => Symbol.for("s")], ["name", () => 7], ["tags", () => undefined], ["tags", () => "text"], ["inner", () => undefined], ["inner", () => new Odd()], ["inner", () => () => 1], ["inner", () => Symbol.iterator], ["n", () => "n"]];
function spell(row: Row): string { return [typeof row.id, String(row.id), typeof row.name, String(row.name), typeof row.tags, Array.isArray(row.tags) ? row.tags.length : "-", typeof row.inner, "inner" in row, Object.keys(row).join("")].join(":"); }
for (const [key, give] of gives) {
  const rows = JSON.parse(text, (k, v) => (k === key ? give(v) : v)) as Row[];
  console.log(key, rows.map(spell).join(" "));
}
console.log((JSON.parse(text) as Row[]).map(spell).join(" "));
