// The namespace object that require() answers for an ES module lets no export go: `delete` answers false, and throws in strict code. A name that the module does not export goes.
const values = require("./values.mjs");
console.log(delete values.first, delete values["second"], delete values.absent, delete require("./values.mjs").second);
console.log(values.first, values.second);

(function () {
  "use strict";
  for (const remove of [() => delete values.first, () => delete require("./values.mjs").second, () => delete values.absent]) {
    try {
      console.log(remove());
    } catch (error) {
      console.log(error.constructor.name, error.message);
    }
  }
})();
console.log(values.first, values.second);

const neverRead = require("./never-read.mjs");
console.log(delete neverRead.only);

const chained = require("./read-through-a-chain.mjs");
console.log(delete chained?.only, chained.only);
require("./in-a-strict-file.cjs");
