"use strict";
const said = [];
for (let path of ["./part", "./parta"]) {
  said.push(require(path + ".js"));
  path += "a";
  said.push(require(path + ".js"));
}
console.log("SAID", said.join());
