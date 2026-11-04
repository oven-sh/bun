// a stranger in the last member throws from its toJSON, behind members that are written already: at a call by itself, in a row of joins, in a text that grows. The error is the stranger's, it runs once, and the next text is whole
type Row = { id: number; name: string; last: number };
let runs = 0;
function write(row: Row): string {
  return JSON.stringify(row);
}
function event(row: Row): string {
  return "data: " + JSON.stringify(row) + "\n\n";
}
function lines(rows: Row[]): string {
  let out = "";
  for (let i = 0; i < rows.length; i++) out += JSON.stringify(rows[i]) + "\n";
  return out;
}
const good = (id: number): Row => ({ id, name: "written before the throw", last: id });
const bad = (id: number): Row => ({
  id,
  name: "written before the throw",
  last: {
    toJSON() {
      runs++;
      throw new RangeError("stranger " + id);
    },
  } as any,
});
function tell(deed: () => string) {
  try {
    console.log(deed());
  } catch (e) {
    console.log((e as Error).name, (e as Error).message, runs);
  }
}
for (let i = 0; i < 12; i++) {
  tell(() => write(i % 2 ? bad(i) : good(i)));
  tell(() => event(i % 2 ? bad(i) : good(i)));
  tell(() => lines([good(i), i % 2 ? bad(i) : good(i + 20), good(i + 40)]));
}
tell(() => write(good(99)) + event(good(99)) + lines([good(99)]));
