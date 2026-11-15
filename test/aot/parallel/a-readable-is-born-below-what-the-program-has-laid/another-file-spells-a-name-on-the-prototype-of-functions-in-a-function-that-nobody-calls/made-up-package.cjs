function runOnce(callee) {
  let ran = false;
  let result;
  return function () {
    if (ran) return result;
    ran = true;
    return (result = callee.apply(this, arguments));
  };
}
module.exports = runOnce;
runOnce.extendFunctions = runOnce(function () {
  Object.defineProperty(Function.prototype, "madeUpOnce", {
    value: function () {
      return runOnce(this);
    },
    configurable: true,
  });
});
