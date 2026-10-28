// RUN(RECORDS): link
// RECORDS-COUNT-2: module {{*}}kind=CommonJs

// RUN(SITES): link
// SITES: EvaluateModule module=m{{*}} [isBare]

// RUN(NOWHERE): link
// NOWHERE-NOT: calleeName="__commonJS"
// NOWHERE-NOT: calleeName="require_m0"

// RUN(FILE): link
// FILE: function {{*}}kind=Module
// FILE-NOT: PropSet
// FILE: function {{*}}role=Library

// Each `__commonJS(callback)` of a bundle is a module whose body is the callback, and each `require_x()` is a require of it. Nothing is left of the statements that define the wrappers.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

var require_m0 = __commonJS((exports) => {
  exports.c = 1;
});

var require_m1 = __commonJS((exports) => {
  var a = require_m0();
  exports.c = a.c + 1;
});

var a = require_m1();
console.log(a.c);
