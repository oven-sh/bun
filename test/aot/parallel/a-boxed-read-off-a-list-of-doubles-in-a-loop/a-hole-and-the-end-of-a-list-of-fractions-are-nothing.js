// STATISTIC: BoxedReadsWithDoublePath >= 4
// A hole in a list of fractions, and a place behind its end, are read as undefined, not as a number that is none, by the same four reads that find fractions.
const [whole, short] = JSON.parse("[[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5],[0.5,1.5,2.5,3.5,4.5,5.5]]");
const holed = whole.slice();
delete holed[2];
delete holed[7];
function Grid() { this.cells = null; this.more = 0; }
Grid.prototype.take = function take(cells, more) { this.cells = cells; this.more = more; };
Grid.prototype.fold = function fold() {
  var cells = this.cells, total = 0, found = "";
  for (var i = 0; i + 3 < cells.length + this.more; i += 4) {
    const a = cells[i], b = cells[i + 1], c = cells[i + 2], d = cells[i + 3];
    const part = a * d - b * c;
    if (part === part) total += part;
    else found += String(a) + " " + String(b) + " " + String(c) + " " + String(d) + ";";
  }
  return [total, found];
};
const grid = new Grid();
for (let turn = 0; turn < 3; turn++)
  for (const [name, cells, more] of [["whole", whole, 0], ["holed", holed, 0], ["short", short, 2]]) {
    grid.take(cells, more);
    console.log("SAID", turn, name, JSON.stringify(grid.fold()));
  }
