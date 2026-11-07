// COUNTER: CompiledStructuresMade <= 8
// COUNTER: operationAOTGetByIdAndCache <= 8
// Two slots of eight bytes fill a cell of 32: there is no room left behind them.
class Holder { text: string; turn: number; constructor(value: any, turn: number) { this.text = value; this.turn = turn; } }
function run(count: number) { let total = 0; for (let i = 0; i < count; i++) { const holder = new Holder((i & 1) === 0 ? i : "t", i); total += String(holder.text).length + (holder.turn & 1); } return total; }
console.log(run(2000));
