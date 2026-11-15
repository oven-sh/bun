// STATISTIC: BoxedReadsWithDoublePath >= 8
// Four reads stand in one block of a loop. What reckons with them stands behind tests, in later blocks. The list is proven a list, what it holds is known to nobody.
const lists = JSON.parse('{"fractions":[0.5,1.5,-0,3,4.25,-5.5,6.75,8,1e300,-1e-300,0.1,0.2],"whole":[1,2,3,4,5,6,7,8,9,10,11,12],"mixed":[1,2.5,3,4.5,5,6.5,7,8.5,9,10.5,11,12.5]}');
function Grid() { this.cells = null; }
Grid.prototype.take = function take(cells) { this.cells = cells; };
Grid.prototype.fold = function fold() {
  var cells = this.cells, total = 0, least = 0;
  for (var i = 0; i + 3 < cells.length; i += 4) {
    const a = cells[i], b = cells[i + 1], c = cells[i + 2], d = cells[i + 3];
    total += a * d - b * c;
    least = Math.min(least, c * a);
  }
  return [total, Object.is(least, -0) ? "-0" : least];
};
const grid = new Grid();
for (let turn = 0; turn < 3; turn++)
  for (const name of Object.keys(lists)) {
    grid.take(lists[name]);
    console.log("SAID", turn, name, JSON.stringify(grid.fold()));
  }
