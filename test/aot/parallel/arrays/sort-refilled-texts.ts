// Alone: whether sum() asks for storage of doubles is a fact about the whole program.
// The comparator empties the list of texts that is being sorted, fills it with fractions and hands it to code that turns its storage into storage for doubles.
// The values were taken out before the first comparison, and they go back whatever the list has become.
function sum(numbers: number[]): number { let s = 0; for (let k = 0; k < numbers.length; k++) s += numbers[k] * 0.5; return s; }
let heat = 0;
for (let i = 0; i < 300; i++) heat += sum([i + 0.5, i + 1.5, i + 2.5]);
function show(list: any[]): string { let s = list.length + ":"; for (let k = 0; k < list.length; k++) s += " " + (k in list ? typeof list[k] === "object" ? "k" + list[k].k : String(list[k]) : "hole"); return s; }
function run(changes: boolean): string {
  const list: any[] = JSON.parse('["c", "a", "b"]');
  let calls = 0;
  list.sort((p: any, q: any) => {
    if (calls++ === 0 && changes) { list.length = 0; list.push(0.5, 1.5, 2.5); sum(list); }
    return p < q ? -1 : p > q ? 1 : 0;
  });
  return show(list);
}
for (let turn = 0; turn < 64; turn++) { const said = run(turn >= 60); if (turn === 59 || turn === 63) console.log(said); }
console.log(heat > 0);
