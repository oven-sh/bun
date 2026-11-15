// an ES module: nothing shows that its variables are filled at every read. The lists are read in a method that is copied in line, by some turns alone; between two calls a whole number past an int32 is stored among the keys.
var ROW = [], COL = [];
for (var k = 0; k < 36; k++) { ROW[k] = (k / 6) | 0; COL[k] = k % 6; }
function Board() { this.cells = []; this.rows = []; this.cols = []; for (var i = 0; i < 36; i++) this.cells[i] = i % 4 === 0 ? 1 : 0; for (i = 0; i < 6; i++) { this.rows[i] = 1 << i; this.cols[i] = 64 << i; } }
Board.prototype.free = function (cell) { return 4095 & ~(this.rows[ROW[cell]] | this.cols[COL[cell]]); };
Board.prototype.weigh = function () {
  var sum = 0;
  for (var i = 0; i < 36; i++) {
    if (this.cells[i]) continue;
    sum += this.free(i);
  }
  return sum;
};
var board = new Board(), all = '';
for (var t = 0; t < 60; t++) {
  if (t === 41) COL[9] = 4294967299;
  var said = board.weigh();
  if (t >= 40 && t <= 42) all += said + '|';
}
console.log(all);
