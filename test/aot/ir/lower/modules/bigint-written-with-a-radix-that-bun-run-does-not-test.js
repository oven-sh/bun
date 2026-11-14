// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK-NOT: kind=Module

// Of `0x1n` `bun run` keeps the text and does not know whether it is zero. It keeps the branch, which names `module`: the file is CommonJS.
if (0x1n) {
} else {
  module.exports = 1;
}
