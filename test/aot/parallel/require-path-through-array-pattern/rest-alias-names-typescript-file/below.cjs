let rows;
const [...[first]] = (rows = [{ file: "./part.cts" }]);
console.log(first.file);
console.log(
  "SAID",
  require(rows[0].file).part,
  (function () {
    return this === undefined ? "strict" : "sloppy";
  })(),
);
