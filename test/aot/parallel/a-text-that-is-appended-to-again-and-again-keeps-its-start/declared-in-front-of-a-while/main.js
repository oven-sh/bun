"use strict";
const said = [];
let path = "./part";
let turns = 0;
while (turns++ < 3) {
  path += "a";
  said.push(require(path + ".js"));
}
console.log("SAID", said.join());
