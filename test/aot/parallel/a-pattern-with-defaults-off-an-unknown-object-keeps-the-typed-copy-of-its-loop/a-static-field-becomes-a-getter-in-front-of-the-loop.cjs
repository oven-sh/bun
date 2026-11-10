class Board {
  static options = JSON.parse('{"size":4,"gap":2}');
  static at(i) {
    const { size = 10, gap = 3, wrap = false } = this.options;
    return i * size + gap + (wrap ? 1 : 0);
  }
}
function run(turns) {
  let s = 0;
  for (let i = 0; i < turns; i++) s += Board.at(i & 7);
  return s;
}
const turns = Number(process.argv[2] || 40);
console.log(run(turns), run(0));
let asked = 0;
Object.defineProperty(Board, "options", { configurable: true, get() { asked++; return { size: 5, wrap: true }; } });
console.log(run(turns), asked);
console.log(run(turns), run(0));
