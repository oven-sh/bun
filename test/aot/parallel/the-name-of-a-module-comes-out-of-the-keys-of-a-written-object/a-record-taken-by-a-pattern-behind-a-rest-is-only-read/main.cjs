let rows;
const [...[first]] = (rows = [{ file: "./a.cjs" }]);
console.log(first.file);
console.log(require(rows[0].file));
