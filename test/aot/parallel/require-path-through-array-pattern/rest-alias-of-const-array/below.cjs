const rows = [{ file: "./part.cjs" }];
const [...[first]] = rows;
console.log(first.file);
console.log(
  "SAID",
  require(rows[0].file).part,
  (function () {
    return this === undefined ? "strict" : "sloppy";
  })(),
);
