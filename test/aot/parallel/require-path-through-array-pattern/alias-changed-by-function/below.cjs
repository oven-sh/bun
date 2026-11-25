function change(row) {
  row.file = "./other.cjs";
}
let rows;
const [...[first]] = (rows = [{ file: "./part.cjs" }]);
change(first);
require(rows[0].file);
