// RUN: link
// CHECK: function {{*}}name="value" {{*}}kind=BaseConstructor
// CHECK: function {{*}}name="unread" {{*}}kind=BaseConstructor

// FILE: main.cjs
const { read } = require("./defines.cjs");
const { kept } = require("./literal.cjs");
console.log(read, kept);

// FILE: defines.cjs
Object.defineProperty(exports, "read", { value: 1 });
Object.defineProperty(exports, "unread", {
  value: class {
    static told = console.log(this.name);
  },
});

// FILE: literal.cjs
module.exports = {
  kept: 1,
  unread: class {
    static told = console.log(this.name);
  },
};
