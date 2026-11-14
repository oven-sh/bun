// The first turn loads the helper. Its function is copied into the loop and reads a constant of the helper's file, which nobody has filled in front of the loop.
"use strict";
let sum = 0;
for (let turn = 0; turn < Number("3"); turn++) {
  const helper = require("./helper.cjs");
  sum += helper.read(turn);
}
console.log(sum);
