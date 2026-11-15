let rows;
const [...[first]] = (rows = [{ file: "./part.cjs" }]);
console.log(first.file);
console.log("SAID", require(rows[0].file).part);
