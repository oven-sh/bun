class Board { constructor(options) { this.options = options; } at(i) { const { span = 10, inset = 3, loops = false } = this.options; return i * span + inset + (loops ? 1 : 0); } }
const board = new Board(JSON.parse("null"));
function run(turns) { let s = 0; for (let i = 0; i < turns; i++) s += board.at(i & 7); return s; }
function attempt(turns) { try { return run(turns); } catch (error) { return error.constructor.name + ": " + error.message; } }
console.log(run(0), attempt(0), attempt(3));
