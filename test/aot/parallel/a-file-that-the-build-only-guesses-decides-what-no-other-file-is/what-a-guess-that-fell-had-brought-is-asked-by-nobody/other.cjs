console.log(
  "SAID other",
  (function () {
    return this === undefined ? "strict" : "sloppy";
  })(),
);
