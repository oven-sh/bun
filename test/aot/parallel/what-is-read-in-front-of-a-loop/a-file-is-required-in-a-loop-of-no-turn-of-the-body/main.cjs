// The loop has no turn, so the helper never loads, and nothing of its file is read.
"use strict";
let sum = 0;
for (let turn = 0; turn < Number("0"); turn++) {
  const helper = require("./helper.cjs");
  sum += helper.read(turn);
}
console.log(sum);
