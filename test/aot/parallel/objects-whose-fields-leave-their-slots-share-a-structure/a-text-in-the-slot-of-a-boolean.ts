// COUNTER: CompiledStructuresMade <= 8
// COUNTER: operationAOTGetByIdAndCache <= 8
class Switch { on: boolean; turn: number; constructor(on: any, turn: number) { this.on = on; this.turn = turn; } }
function run(count: number) { let total = 0; for (let i = 0; i < count; i++) { const one = new Switch((i & 1) === 0 ? "yes" : true, i); total += (one.on ? 1 : 0) + (one.turn & 1); } return total; }
console.log(run(2000));
