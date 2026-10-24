// Parsed text cast to an interface has a member beside the declared ones. Another object of the interface gets that name by an untyped store, with another type.
interface Entry {
  count: number;
}
function parse(text: string): Entry {
  return JSON.parse(text) as Entry;
}
function untyped(o: any): string {
  return typeof o.late + ":" + String(o.late) + " " + Object.keys(o).join("+") + " " + JSON.stringify(o);
}
function twice(e: Entry): number {
  return e.count * 2;
}
const a = parse('{"count": 1, "late": 5}');
const b: Entry = { count: 2 };
(b as any).late = "text";
const c = parse('{"late": [1, 2], "count": 3}');
const d = parse('{"count": 4}');
const e = parse('{"count": 5, "late": "fits"}');
for (const o of [a, b, c, d, e]) console.log(twice(o), untyped(o));
let total = 0;
for (let i = 0; i < 5000; i++) {
  const o: any = i % 5 === 0 ? a : i % 5 === 1 ? b : i % 5 === 2 ? c : i % 5 === 3 ? d : e;
  total += twice(o) + (typeof o.late === "string" ? o.late.length : o.late === undefined ? 0 : 1);
}
console.log(total);
