// `__esModule` of what require() answers for an ES module takes a store: a falsy value takes the mark away, any other puts it back.
const values = require("./values.mjs");
console.log(values.__esModule, values.count);
values.__esModule = false;
console.log(values.__esModule, values.count);
(function () {
  "use strict";
  values.__esModule = 5;
})();
console.log(values.__esModule, require("./values.mjs").__esModule);

const untouched = require("./untouched.mjs");
console.log(untouched.__esModule, untouched.name);

const storedInCodeThatNeverRuns = require("./stored-in-code-that-never-runs.mjs");
function neverCalled() {
  storedInCodeThatNeverRuns.__esModule = false;
}
console.log(storedInCodeThatNeverRuns.__esModule, storedInCodeThatNeverRuns.name, typeof neverCalled);

const own = require("./exports-the-name-itself.mjs");
try {
  own.__esModule = 3;
} catch (error) {
  console.log(error.constructor.name);
}
console.log(own.__esModule);

require("./stores-in-another-file.cjs");
const { __esModule: mark, name } = require("./stored-by-another-file.mjs");
console.log(mark, name, require("./stored-by-another-file.mjs").__esModule);
