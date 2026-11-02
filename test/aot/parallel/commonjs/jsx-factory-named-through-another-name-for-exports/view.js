/** @jsxRuntime classic */
/** @jsx out.h */
var out = exports;
out.h = function (tag) {
  return "h:" + tag + ":" + Object.keys(this).join();
};
out.v = <div />;
