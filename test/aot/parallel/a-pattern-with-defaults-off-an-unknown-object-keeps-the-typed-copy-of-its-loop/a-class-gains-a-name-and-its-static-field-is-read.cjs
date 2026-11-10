class Board {
  static options = JSON.parse('{"size":4,"gap":2}');
  static at(i) {
    return i * this.options.size + this.options.gap;
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
