"use strict";
// A constructor function made in a function that runs once for each evaluation of the module, with a prototype object that the module stores.
const NullObject = (() => {
  const C = function () {};
  C.prototype = Object.create(null);
  return C;
})();
function Pair(key, value) {
  this.key = key;
  this.value = value;
}
Pair.prototype.describe = function () {
  return this.key + "=" + this.value;
};
function parse(header) {
  const parameters = new NullObject();
  let index = 0;
  let start = 0;
  let pairs = 0;
  while (index <= header.length) {
    if (index === header.length || header.charCodeAt(index) === 59) {
      const equals = header.indexOf("=", start);
      const pair = new Pair(header.slice(start, equals), header.slice(equals + 1, index));
      if (parameters[pair.key] === undefined) parameters[pair.key] = pair;
      start = index + 1;
      pairs++;
    }
    index++;
  }
  return { parameters, pairs };
}
module.exports = { NullObject, Pair, parse };
