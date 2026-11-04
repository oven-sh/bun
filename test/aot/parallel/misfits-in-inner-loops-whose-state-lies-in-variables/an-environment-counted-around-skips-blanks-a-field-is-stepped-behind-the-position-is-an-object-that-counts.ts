type Row = { text: string };
const unseen = (0, eval)("(x) => x");
let deeds = 0; let asked = 0;
function make() {
  let text = ""; let at = 0; let limit = 0; let turns = 0; let begun = 0; let blanks = 0;
  function begin(next: string) { text = next; at = 0; limit = next.length; if (++begun === (globalThis as any).when) { at = (globalThis as any).misfit; } }
  function unitAt(i: number) { return text.charCodeAt(i); }
  function run(rows: Row[], state: { count: number }, log: number[]): number { let total = 0; for (let r = 0; r < rows.length; r++) { const row = rows[r];  begin(row.text); while (at < limit && text.charCodeAt(at) === 32) at++; total += Number(at); state.count++; } return total + turns + blanks; }
  return run;
}
const run = make();
const rows: Row[] = []; const state = { count: 0 }; const log: number[] = [];
for (let r = 0; r < 12; r++) rows.push({ text: " ".repeat(r % 5) + "x" });
(globalThis as any).when = 20; (globalThis as any).misfit = { valueOf() { asked++; return 0; } };
for (let k = 0; k < 3; k++) console.log(String(run(unseen(rows), unseen(state), unseen(log))), deeds, asked, state.count, log.length, log.join(""));
