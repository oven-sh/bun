// COUNTER: CompiledStructuresMade <= 8
// COUNTER: operationAOTGetByIdAndCache <= 8
// The slot is held to the whole numbers of 32 bits and to texts. Every second store brings a fraction.
class Step { level: 0 | 1 | 2 | "top"; turn: number; constructor(level: any, turn: number) { this.level = level; this.turn = turn; } }
function run(count: number) { let total = 0; for (let i = 0; i < count; i++) { const step = new Step((i & 1) === 0 ? 0.5 : "top", i); total += String(step.level).length + (step.turn & 1); } return total; }
console.log(run(2000));
