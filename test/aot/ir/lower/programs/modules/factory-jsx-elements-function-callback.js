// RUN: lower
// OPTIONS: builtin-modules

// `@jsx exports.h`, where `exports` is the first parameter of the callback that `__commonJS(..)` takes.
/** @jsxRuntime classic */
/** @jsx exports.h */
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_lib = __commonJS((exports, module) => {
  exports.h = tag => "h:" + tag;
  exports.v = <div />;
});
console.log(require_lib().v);

// CHECK-LABEL: function {{*}}name="__commonJS"
