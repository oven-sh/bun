// COUNTER: CompiledStructuresMade <= 8
// COUNTER: operationAOTGetByIdAndCache <= 8
// The slot is held to the objects of one class, and every second store brings one of another.
class Lid { width: number; constructor(width: number) { this.width = width; } }
class Cork { width: number; depth: number; constructor(width: number) { this.width = width; this.depth = 1; } }
class Jar { top: Lid; turn: number; constructor(top: any, turn: number) { this.top = top; this.turn = turn; } }
function run(count: number) { let total = 0; for (let i = 0; i < count; i++) { const jar = new Jar((i & 1) === 0 ? new Cork(i) : new Lid(i), i); total += jar.top.width + (jar.turn & 1); } return total; }
console.log(run(2000));
