// RUN: lower
// CHECK: function {{*}}kind=Module
// CHECK-NOT: kind=CommonJsModule
// CHECK-NOT: ModuleObject

// `bun run` writes 4 in place of `Level.High` and removes the branch, so nothing in the file names `module`: it is an ES module.
enum Level {
  High = 4,
}
if (Level.High) {
} else {
  module.exports = 1;
}
