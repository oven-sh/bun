exports.add = function () {
  Function.prototype.fromHelper$0 = function () { return "helper:" + typeof this; };
};
exports.remove = function () {
  delete Function.prototype.fromHelper$0;
};
