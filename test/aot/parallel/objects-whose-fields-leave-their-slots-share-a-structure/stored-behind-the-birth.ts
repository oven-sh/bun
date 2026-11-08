// COUNTER: CompiledStructuresMade <= 8
// COUNTER: operationAOTGetByIdAndCache <= 8
// The object is born with a text. A function that is no maker stores the number.
class Holder { text: string; turn: number; constructor(turn: number) { this.text = "t"; this.turn = turn; } }
function relabel(holder: Holder, value: any) { holder.text = value; }
function run(count: number) { let total = 0; for (let i = 0; i < count; i++) { const holder = new Holder(i); if ((i & 1) === 0) relabel(holder, i); total += String(holder.text).length + (holder.turn & 1); } return total; }
console.log(run(2000));
