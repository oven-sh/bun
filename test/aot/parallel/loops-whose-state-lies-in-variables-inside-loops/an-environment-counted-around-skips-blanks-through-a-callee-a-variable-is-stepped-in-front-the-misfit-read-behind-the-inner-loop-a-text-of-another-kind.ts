type Box = { value: number }; type Row = { text: string };
const unseen = (0, eval)("(x) => x");
let deeds = 0;
function make() {
  let text = ""; let at = 0; let limit = 0; let turns = 0;
  function begin(next: string) { text = next; at = (globalThis as any).once === turns ? 0.5 : 0; limit = text.length; }
  function unitAt(i: number) { return text.charCodeAt(i); }
  function run(rows: Row[], extras: Box[], state: { count: number }, log: number[]): number { let total = 0; for (let r = 0; r < rows.length; r++) { const row = rows[r]; const extra = extras[r]; deeds++;  begin(row.text); while (at < limit && unitAt(at) === 32) at++; total += at;  total += extra.value; } return total + turns; }
  return run;
}
const run = make();
const rows: Row[] = []; const extras: Box[] = []; const state = { count: 0 }; const log: number[] = [];
for (let r = 0; r < 12; r++) { rows.push({ text: " ".repeat(r % 5) + "x" }); extras.push({ value: 1 }); }
rows[7] = { text: new String('   x') as any };
for (let k = 0; k < 3; k++) console.log(run(unseen(rows), unseen(extras), unseen(state), unseen(log)), deeds, state.count, log.length, log.join(""));
