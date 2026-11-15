// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/partaa.js"

// FILE: main.cjs
// The binding that the head of a plain `for` declares is carried from turn to turn, so the append runs again and again on one text: what stands in front stays, and every file that begins so is brought.
"use strict";
for (let path = "./part", turn = 0; turn < 2; turn++) {
  path += "a";
  console.log(require(path + ".js"));
}

// FILE: part.js
module.exports = "part";

// FILE: parta.js
module.exports = "parta";

// FILE: partaa.js
module.exports = "partaa";
