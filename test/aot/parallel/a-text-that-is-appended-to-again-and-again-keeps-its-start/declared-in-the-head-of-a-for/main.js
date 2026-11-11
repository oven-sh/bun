"use strict";
const said = [];
for (let path = "./part", turn = 0; turn < 3; turn++) {
  path += "a";
  said.push(require(path + ".js"));
}
console.log("SAID", said.join());
