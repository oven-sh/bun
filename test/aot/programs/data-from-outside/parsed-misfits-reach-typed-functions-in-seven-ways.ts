// Parsed JSON that does not fit its type reaches typed functions in seven ways. Any object, an array too, passes the cast, the annotation and the parameter as it is, and so does null; a number, a string or a boolean throws there. A missing field reads undefined, and a field of another kind throws at its first typed read.
interface Point { x: number; y: number }
interface Row { id: number; name: string; at: Point; next: Row | null }
interface Other { id: number }
function show(row: Row): string {
  return String(row.id) + "|" + String(row.name) + "|" + String(row.at && row.at.x) + "|" + String(row.next && row.next.id) + "|" + Object.keys(row).join(",");
}
function grow(row: Row): string { row.id = 7; row.name = row.name + "!"; return show(row); }
function attempt(label: string, run: () => string): void {
  try { console.log(label + " " + run()); } catch (error) { console.log(label + " threw " + (error as Error).constructor.name); }
}
const made: Row = { id: 1, name: "a", at: { x: 1, y: 2 }, next: null };
const texts: string[] = [
  '{"id":2,"name":"b","at":{"x":3,"y":4},"next":null}',
  '{"next":null,"at":{"y":4,"x":3},"name":"b","id":2}',
  '{"id":"two","at":null}',
  '{"name":5,"id":1,"extra":true,"at":{"y":1}}',
  '{"next":{"id":9},"id":1.5,"name":"n","at":{"x":"x","y":[]}}',
  '{"id":2,"name":"b","at":{"x":3,"y":4},"next":null,"more":1,"evenMore":{"deep":[1,2]}}',
  '{}', '[]', '[1,2]', '7', '"text"', 'true', 'null',
];
attempt("made", () => show(made));
for (const text of texts) {
  attempt("as", () => show(JSON.parse(text) as Row));
  attempt("declared", () => { const row: Row = JSON.parse(text); return show(row); });
  attempt("through", () => { const other = JSON.parse(text) as Other; return show(other as unknown as Row); });
  attempt("stored", () => grow(JSON.parse(text) as Row));
  attempt("held", () => { const holder: { row: Row } = { row: JSON.parse(text) as Row }; return show(holder.row); });
  attempt("listed", () => { const rows: Row[] = [made, JSON.parse(text) as Row]; return rows.map(show).join(" & "); });
  attempt("linked", () => { const head: Row = { id: 0, name: "h", at: { x: 0, y: 0 }, next: JSON.parse(text) as Row }; return show(head); });
}
attempt("made again", () => grow(made));
