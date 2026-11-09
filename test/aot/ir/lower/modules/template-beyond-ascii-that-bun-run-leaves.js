// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK-NOT: kind=Module

// `bun run` joins a template into one text only where every piece is ASCII. It leaves this one, so it keeps the branch, which names `module`: the file is CommonJS.
if (`é${1}`) {
} else {
  module.exports = 1;
}
