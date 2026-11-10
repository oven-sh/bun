console.log(
  "part is",
  (function () {
    return this === undefined ? "strict" : "sloppy";
  })(),
);
