// Texts that hold members which the program's own objects of that shape never have.
type Row = { id: number; name: string };
type Nested = { row: Row; rows: Row[]; tag?: string };
const made: Row = { id: 1, name: "made" };
const nest: Nested = { row: made, rows: [made, { id: 2, name: "two" }] };
const out: string[] = [];
function show(label: string, value: unknown) {
  out.push(label + " " + JSON.stringify(value) + " " + (value && typeof value === "object" ? Object.keys(value as object).join() : ""));
}
function row(text: string): Row { return JSON.parse(text) as Row; }
function nested(text: string): Nested { return JSON.parse(text) as Nested; }
function use(r: Row): string { return r.id + ":" + r.name + ":" + ("ok" in r) + ":" + Object.keys(r).length; }
const texts = [
  '{"id":7,"name":"row"}',
  '{"id":7,"name":"row","ok":true}',
  '{"ok":true,"id":7,"name":"row"}',
  '{"id":7,"ok":true,"name":"row"}',
  '{"name":"row","id":7}',
  '{"name":"row","extra":{"id":1,"name":"inner","more":[1,2]},"id":7}',
  '{"id":7,"name":"row","id":8}',
  '{"id":7,"name":"row","ok":1,"ok":2}',
  '{"id":7,"name":"row","__proto__":{"x":1}}',
  '{"id":7,"name":"row","0":"zero","1":"one"}',
  '{"1":"one","id":7,"0":"zero","name":"row"}',
  '{"id":7}',
  '{"ok":1}',
  '{}',
  '{"id":"text","name":5,"ok":null}',
  ' { "id" : 7 , "name" : "row" , "ok" : [ ] } ',
  '{"id":7,"name":"row","\\u006fk":true}',
  '{"id":7,"n\\u0061me":"escaped","ok":true}',
  '{"id":7,"name":"row","constructor":1,"toString":2,"hasOwnProperty":3}',
];
for (let round = 0; round < 60; round++) {
  out.length = 0;
  for (const text of texts) { const r = row(text); show(text, r); out.push(use(r)); }
  show("made", made); out.push(use(made));
  for (const text of [
    '{"row":{"id":1,"name":"a","x":1},"rows":[{"id":2,"name":"b"},{"id":3,"name":"c","y":2},{"z":0,"id":4,"name":"d"}]}',
    '{"row":{"id":1,"name":"a"},"rows":[],"tag":"t","more":{"row":{"id":9,"name":"deep","w":1}}}',
    '{"more":1,"row":{"id":1,"name":"a"},"rows":[{"id":2,"name":"b"}]}',
  ]) { const n = nested(text); show(text, n); out.push(use(n.row) + "|" + n.rows.map(use).join("|") + "|" + n.tag); }
  for (const bad of ['{"id":7,"name":"row","ok":}', '{"id":7,"name":"row","ok":true', '{"id":7,"name":"row",}', '{"id":7,"name":"row" "ok":1}', '{"id":7,"ok":tru,"name":"x"}']) {
    try { show(bad, row(bad)); } catch (e) { out.push(bad + " " + (e as Error).name); }
  }
  const revived = JSON.parse('{"id":7,"name":"row","ok":true}', (k, v) => (k === "ok" ? undefined : v)) as Row;
  show("revived", revived);
  const written = row('{"id":7,"name":"row","ok":true}'); written.id = 9; (written as any).later = 1; delete (written as any).ok; show("written", written);
}
show("nest", nest);
console.log(out.join("\n"));
