// RUN(ONCE): link
// ONCE: function {{*}}kind=CommonJsModule
// ONCE-NOT: PutModuleVariable
// ONCE: [[seven]] = Integer integer=7
// ONCE-NEXT: PutModuleVariable [[seven]] variable=
// ONCE-NEXT: PutModuleVariable
// ONCE-NOT: PutModuleVariable
// ONCE: Return

// What TypeScript writes for CommonJS, in the wrapper of a bundler: the callback is the body of the module and runs once, whether or not it throws.
// The variable of a name is born undefined and nothing has run when `void 0` is stored under every name, so each name is stored once.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

var require_leaf = __commonJS((exports) => {
  "use strict";
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.add = exports.LIMIT = void 0;
  exports.LIMIT = 7;
  function add(a, b) { return a + b; }
  exports.add = add;
});

var leaf_1 = require_leaf();
console.log((0, leaf_1.add)(1, leaf_1.LIMIT));
