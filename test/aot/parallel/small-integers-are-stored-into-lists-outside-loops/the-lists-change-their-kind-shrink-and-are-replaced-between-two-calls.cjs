var ROWOF = [], COLOF = [], BOXOF = [];
for (var i = 0; i < 81; i++) { ROWOF[i] = (i / 9) | 0; COLOF[i] = i % 9; BOXOF[i] = ((ROWOF[i] / 3) | 0) * 3 + ((COLOF[i] / 3) | 0); }
function Grid(make) { this.rows = make(9); this.cols = make(9); this.boxes = make(9); this.cells = make(81); this.refused = 0; }
Grid.prototype.place = function (cell, digit) {
  var bit = 1 << (digit - 1);
  if ((this.rows[ROWOF[cell]] | this.cols[COLOF[cell]] | this.boxes[BOXOF[cell]]) & bit) { this.refused++; return false; }
  this.rows[ROWOF[cell]] |= bit;
  this.cols[COLOF[cell]] |= bit;
  this.boxes[BOXOF[cell]] |= bit;
  this.cells[cell] = digit;
  return true;
};
Grid.prototype.remove = function (cell) {
  var bit = 1 << (this.cells[cell] - 1);
  this.rows[ROWOF[cell]] &= ~bit;
  this.cols[COLOF[cell]] &= ~bit;
  this.boxes[BOXOF[cell]] &= ~bit;
  this.cells[cell] = 0;
};
Grid.prototype.walk = function (from, depth) {
  if (depth === 0) return 0;
  var cell = (from * 7 + depth * 13) % 81, digit = 1 + (from + depth) % 9, placed = this.place(cell, digit);
  var below = this.walk(from + 1, depth - 1);
  if (placed && (from + depth) % 3 === 0) this.remove(cell);
  return below + (placed ? 1 : 0);
};
function show(list) { var text = ""; for (var k = 0; k < list.length && k < 90; k++) text += (k in list ? typeof list[k] === "number" ? list[k] : typeof list[k] : "-") + ","; return list.length + ":" + text; }
var said = [];
function tell(grid) { said.push(show(grid.rows), show(grid.cols), show(grid.boxes), show(grid.cells).length, grid.refused); }
var zeros = function (n) { var list = []; for (var k = 0; k < n; k++) list[k] = 0; return list; };
var acts = [function (g) { g.rows.push(0.5); }, function (g) { g.cols.push("text"); }, function (g) { g.boxes.length = 4; }, function (g) { g.rows = zeros(9); }, function (g) { Object.freeze(g.cols); }, function (g) { g.boxes[100000] = 1; }, function (g) { g.rows.shift(); }, function (g) { g.cells.length = 0; }, function (g) { g.cols = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]; }];
for (var a = 0; a < acts.length; a++) { var grid = new Grid(zeros); said.push(grid.walk(a, 14)); acts[a](grid); said.push(grid.walk(a + 3, 14)); tell(grid); }
console.log(said.join(" "));
