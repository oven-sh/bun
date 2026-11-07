/** @jsxRuntime classic */
/** @jsx self.exports.h */
var self = module;
self.exports.h = function (tag) {
  return "h:" + tag + ":" + Object.keys(this).join();
};
self.exports.v = <span />;
