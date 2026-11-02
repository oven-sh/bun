// RUN: lower
// CHECK-LABEL: function {{*}}name="watch"
// CHECK: captures=[{type={{*}}FinalizationRegistry
// CHECK-LABEL: function {{*}}name="inner"
// CHECK-NOT: captures=
// CHECK: b0():

// The callbacks are the bodies of modules: they are called, and nothing creates them.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
const registry = new FinalizationRegistry(() => {});
const watch = target => registry.register(target, 1);
var require_a = __commonJS((exports, module) => {
  const inner = () => 1;
  module.exports = () => inner() + 1;
});
var require_b = __commonJS((exports, module) => {
  const a = require_a();
  module.exports = { b: () => a() + 1 };
});
watch({});
console.log(require_a()(), require_b().b());
