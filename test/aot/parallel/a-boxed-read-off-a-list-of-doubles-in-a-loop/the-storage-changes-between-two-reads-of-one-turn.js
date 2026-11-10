// STATISTIC: BoxedReadsWithDoublePath >= 2
// What reckons with the two reads stands behind a test. An operand there runs code that stores a text in the list of fractions: the read behind it finds another storage, and so does the next turn of the loop.
const made = () => JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5]");
function Grid() { this.cells = null; this.counts = false; }
Grid.prototype.take = function take(cells, counts) { this.cells = cells; this.counts = counts; };
Grid.prototype.fold = function fold(factor) {
  var cells = this.cells, total = 0, texts = "";
  for (var i = 0; i + 1 < cells.length; i += 2) {
    const a = cells[i];
    if (this.counts) total += a * factor;
    const b = cells[i + 1];
    if (this.counts) {
      if (typeof b === "number") total += b * 2;
      else texts += b;
    }
  }
  return [total, texts];
};
const grid = new Grid();
for (let turn = 0; turn < 3; turn++) {
  const cells = made();
  let asked = 0;
  grid.take(cells, true);
  console.log("SAID", turn, JSON.stringify(grid.fold({ valueOf() { if (++asked === 2) cells[3] = "three"; if (asked === 3) cells[7] = "seven"; return 10; } })), JSON.stringify(cells));
  grid.take(made(), turn !== 1);
  console.log("SAID", turn, JSON.stringify(grid.fold(10)));
}
