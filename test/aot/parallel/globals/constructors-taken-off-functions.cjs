"use strict";
const lines = [];
const attempt = run => {
  try {
    lines.push(String(run()));
  } catch (error) {
    lines.push(error.constructor.name);
  }
};
exports.twice = function (n) {
  return n * 2;
};
exports.held = 1;
attempt(() => exports.twice instanceof Function);
attempt(() => exports.twice.constructor("return Object.keys(process.mainModule.exports).join()")());
attempt(() => exports.twice.constructor(JSON.parse('"process.mainModule.exports.held = 5; return 2"'))());
attempt(() => exports.held + exports.twice(2));
const { constructor: Made } = exports.twice;
attempt(() => Made("return process.mainModule.exports.held")());
attempt(() => new exports.twice["constructor"]("return typeof process.mainModule.exports.twice")());
console.log(lines.join("\n"));
