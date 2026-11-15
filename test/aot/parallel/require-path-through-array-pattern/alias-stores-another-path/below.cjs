function idle() {}
let rows;
const [...[first]] = (rows = [{ file: "./part.cjs" }]);
first.file = "./other.cjs";
require(rows[0].file);
