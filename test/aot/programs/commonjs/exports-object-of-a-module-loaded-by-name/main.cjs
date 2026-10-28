// A module that is found by a computed name, by module.require or by createRequire runs with the exports object of that module object. A `require` that names the file in writing finds the same object afterwards.
const { describe } = require("../describe-object.cjs");
const Module = require("node:module");
const createdRequire = Module.createRequire(__filename);

function use(label, loaded) {
  describe(label, loaded);
  const name = loaded.read();
  loaded.name = "changed";
  console.log("  read", name, loaded.read(), loaded.same);
  loaded.name = name;
}

function findAgain(spelling, loaded) {
  const found = [require(spelling), module.require(spelling), createdRequire(spelling)];
  console.log("  found again", found.map(each => each === loaded).join());
}

const names = ["first", "second"];
const spellings = names.map(name => ["./", name, ".cjs"].join(""));
for (const spelling of spellings) use(`a computed name, ${spelling}`, require(spelling));
const first = require("./first.cjs");
const second = require("./second.cjs");
findAgain(spellings[0], first);
findAgain(spellings[1], second);
console.log(first === require("./" + names[0] + ".cjs"), second === require("./" + names[1] + ".cjs"), first.partner === second);
first.name = second.name = "changed again";
console.log(first.__esModule, first.name, first.same, first.read(), second.__esModule, second.name, second.same, second.read(), second.keysOfFirst);

use("module.require", module.require("./third.cjs"));
const third = require("./third.cjs");
findAgain("./third.cjs", third);
third.name = "changed again";
console.log(third.__esModule, third.name, third.same, third.read());

use("createRequire", Module.createRequire(__filename)("./fourth.cjs"));
const fourth = require("./fourth.cjs");
findAgain("./fourth.cjs", fourth);
fourth.name = "changed again";
console.log(fourth.__esModule, fourth.name, fourth.same, fourth.read(), fourth.throughModule, fourth.throughThis);
