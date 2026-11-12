class Board { constructor(options) { this.options = options; } at(i) { const { span = 10, inset = 3, loops = false } = this.options; return i * span + inset + (loops ? 1 : 0); } }
const board = new Board(JSON.parse("{\"span\":4}"));
function run(turns) { let s = 0; for (let i = 0; i < turns; i++) { s += board.at(i & 7); if (i === 2) board.options.inset = 50; if (i === 4) delete board.options.span; } return s; }
console.log(run(8));
