// a list in a field that only some turns read; between two calls an element far past its end is stored: its storage is of another kind.
var KEYS = [];
for (var k = 0; k < 40; k++) KEYS[k] = k % 9;
function Board() { this.cells = []; this.rows = []; for (var i = 0; i < 40; i++) this.cells[i] = i % 3 === 0 ? 1 : 0; for (i = 0; i < 9; i++) this.rows[i] = 1 << i; }
Board.prototype.weigh = function () {
  var sum = 0;
  for (var i = 0; i < 40; i++) {
    if (this.cells[i]) continue;
    sum += this.rows[KEYS[i]] | 0;
  }
  return sum;
};
var board = new Board(), all = '';
for (var t = 0; t < 60; t++) {
  if (t === 41) { board.rows[30000000] = 7; board.rows[2] = 2048; }
  var said = board.weigh();
  if (t >= 40 && t <= 42) all += said + '|';
}
console.log(all);
