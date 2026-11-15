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
Object.assign(Board, JSON.parse('{"tag":7}'));
console.log(run(turns), run(0));
