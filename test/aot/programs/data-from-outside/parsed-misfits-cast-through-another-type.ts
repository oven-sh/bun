// The texts of parsed-misfits-reach-typed-functions-in-seven-ways, cast to an unrelated type first and to the type they are read as afterwards. Each cast lets any object pass as it is and throws for a number, a string or a boolean. A missing field reads undefined, and a field of another kind throws at its first typed read.
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
  attempt("through", () => { const other = JSON.parse(text) as Other; return show(other as unknown as Row); });
  attempt("through any", () => { const other = JSON.parse(text) as Other; const row: Row = other as any; return show(row); });
  attempt("through, stored", () => { const other = JSON.parse(text) as Other; return grow(other as unknown as Row); });
  attempt("through, listed", () => { const other = JSON.parse(text) as Other; const rows: Row[] = [made, other as unknown as Row]; return rows.map(show).join(" & "); });
  attempt("through, linked", () => { const other = JSON.parse(text) as Other; const head: Row = { id: 0, name: "h", at: { x: 0, y: 0 }, next: other as unknown as Row }; return show(head); });
}
attempt("back", () => { const other = made as unknown as Other; return String(other.id) + "|" + Object.keys(other).join(","); });
attempt("made again", () => grow(made));
