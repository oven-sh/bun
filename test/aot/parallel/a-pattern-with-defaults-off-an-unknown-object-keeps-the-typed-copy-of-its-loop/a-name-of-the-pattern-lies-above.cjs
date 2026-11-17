class Board { constructor(options) { this.options = options; } at(i) { const { span = 10, inset = 3, loops = false } = this.options; return i * span + inset + (loops ? 1 : 0); } }
const above = JSON.parse("{\"inset\":70}");
const board = new Board(Object.setPrototypeOf(JSON.parse("{\"span\":2}"), above));
function run(turns) { let s = 0; for (let i = 0; i < turns; i++) s += board.at(i & 7); return s; }
console.log(run(9)); above.inset = 1; above.loops = true; console.log(run(9)); delete above.inset; console.log(run(9));
