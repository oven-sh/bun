class Board { constructor(options) { this.options = options; } at(i) { const { span = 10, inset = 3, loops = false } = this.options; return i * span + inset + (loops ? 1 : 0); } }
const seen = [];
const board = new Board(new Proxy(JSON.parse("{\"span\":4}"), { get(target, name) { seen.push(name); return target[name]; } }));
function run(turns) { let s = 0; for (let i = 0; i < turns; i++) s += board.at(i & 7); return s; }
console.log(run(9), run(0), seen.join());
