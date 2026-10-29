import "./a";
require("./b");
console.log(
  (function () {
    return this === undefined;
  })(),
);
