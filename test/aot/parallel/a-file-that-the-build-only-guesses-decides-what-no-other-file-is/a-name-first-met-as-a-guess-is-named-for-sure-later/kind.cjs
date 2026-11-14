console.log(
  "SAID kind",
  (function () {
    return this === undefined ? "strict" : "sloppy";
  })(),
);
