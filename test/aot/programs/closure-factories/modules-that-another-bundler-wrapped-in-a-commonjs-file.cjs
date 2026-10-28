// The same in a CommonJS file, where the helpers are locals of the module's function and the wrappers capture them.
"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) =>
  function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

var require_late_user = __commonJS({
  "late-user.js"(exports2) {
    exports2.value = require_late().value + 1;
  },
});

var require_late = __commonJS({
  "late.js"(exports2, module2) {
    module2.exports = { value: 41 };
  },
});

var require_class = __commonJS({
  "class.js"(exports2, module2) {
    module2.exports = class Box {
      constructor(value) {
        this.value = value;
      }
      get() {
        return this.value;
      }
    };
  },
});

var require_function = __commonJS({
  "function.js"(exports2, module2) {
    module2.exports = function twice(value) {
      return value * 2;
    };
    module2.exports.default = module2.exports;
  },
});

var Box = require_class();
module.exports = { answer: require_late_user().value, box: new Box(7).get(), twice: require_function().default(21) };
console.log(JSON.stringify(module.exports), require_class() === Box, require_late().value);
