// `var before = util.inherits; util.inherits = before;` on the object that the file exports.
var util = (module.exports = {});
var before = util.inherits;
util.inherits = before;
function Base() {}
function Child() {}
try {
  util.inherits(Child, Base);
} catch (error) {
  console.log(error.constructor.name);
}
console.log(typeof before, Object.keys(util).join());
