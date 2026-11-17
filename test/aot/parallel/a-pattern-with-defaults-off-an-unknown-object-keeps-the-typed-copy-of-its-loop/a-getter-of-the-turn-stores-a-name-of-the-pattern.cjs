class Board { constructor(options) { this.options = options; } at(i) { const { span = 10, inset = 3, loops = false } = this.options; return i * span + inset + (loops ? 1 : 0); } }
const options = JSON.parse("{\"span\":4}");
const board = new Board(Object.defineProperty(options, "loops", { get() { options.inset = (options.inset || 0) + 5; return false; }, configurable: true }));
function run(turns) { let s = 0; for (let i = 0; i < turns; i++) s += board.at(i & 7); return s; }
console.log(run(9), run(0));
