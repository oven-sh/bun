/** @jsxRuntime classic */
/** @jsx out.h */
/** @jsxFrag out.part */
var out = exports;
out.part = "part";
out.h = function (tag, props, ...children) {
  return "h:" + tag + ":" + children.join() + ":" + Object.keys(this).join();
};
out.v = <>a</>;
