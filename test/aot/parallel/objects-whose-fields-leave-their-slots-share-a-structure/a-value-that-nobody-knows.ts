// COUNTER: CompiledStructuresCreated <= 8
// COUNTER: operationAOTGetByIdAndCache <= 8
// What is stored comes out of a text that is parsed when the program runs: nobody sees at the build that every second value is a number.
class Holder { text: string; turn: number; constructor(value: any, turn: number) { this.text = value; this.turn = turn; } }
const values = JSON.parse('[1, "t"]');
function run(count: number) { let total = 0; for (let i = 0; i < count; i++) { const holder = new Holder(values[i & 1], i); total += String(holder.text).length + (holder.turn & 1); } return total; }
console.log(run(2000));
