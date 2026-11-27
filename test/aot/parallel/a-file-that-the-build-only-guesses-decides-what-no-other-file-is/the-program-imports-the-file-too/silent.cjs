console.log(
  "SAID silent",
  (function () {
    return this === undefined ? "strict" : "sloppy";
  })(),
);
