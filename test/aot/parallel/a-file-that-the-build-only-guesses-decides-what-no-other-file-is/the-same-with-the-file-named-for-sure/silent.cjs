console.log(
  "SAID body",
  (function () {
    return this === undefined ? "strict" : "sloppy";
  })(),
);
