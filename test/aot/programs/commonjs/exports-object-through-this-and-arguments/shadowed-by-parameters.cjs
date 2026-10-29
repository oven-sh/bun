if (arguments.length !== 5) {
  module.seen = [typeof exports, arguments.length, String(arguments[0]), String(module.exports)].join();
  return;
}
const other = {};
(function (exports) {
  exports.onOther = 1;
})(other);
(function (module) {
  module.exports.alsoOnOther = 2;
})({ exports: other });
{
  let exports = other;
  exports.inBlock = 3;
}
((exports, module) => { exports.inArrow = module.exports.alsoInArrow = 4; })(other, { exports: other });
try { throw other; } catch (exports) { exports.inCatch = 5; }
for (const exports of [other]) exports.inLoop = 6;
(function () {
  var exports = other, module = { exports };
  exports.inFunctionVariable = module.exports.alsoInFunctionVariable = 7;
})();
(function (arguments) { arguments[0].viaParameterCalledArguments = 8; })([other]);
(function () { this.viaOwnReceiver = arguments[0].viaOwnArguments = 9; }).call(other, other);
(function (exports) { exports.holdsTheExportsObject = 10; })(exports);
(function (module) { module.exports.alsoHoldsTheExportsObject = 11; })(module);
const calledAgain = { exports: null };
arguments.callee(undefined, undefined, calledAgain);
exports.calledAgainWithoutAnObject = calledAgain.seen;
exports.own = Object.keys(other).join();
