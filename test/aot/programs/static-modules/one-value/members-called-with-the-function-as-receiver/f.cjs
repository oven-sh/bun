module.exports = f;
module.exports.self = function () {
  return this;
};
module.exports.strictSelf = function () {
  "use strict";
  return this;
};
function f() {}
