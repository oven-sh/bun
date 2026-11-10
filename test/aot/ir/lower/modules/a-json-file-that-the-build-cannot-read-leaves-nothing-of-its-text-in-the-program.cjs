// A file of data that its parser refuses keeps nothing of its bytes: the body of the module that stands for it only throws, and the run time makes the error out of the place that the build kept.
// The text went along as a constant, for JSON.parse to say what is wrong with it. The build warns of the text.
// DIAGNOSTIC: Build 1
// RUN: link
// CHECK-NOT: some words here
// CHECK: ThrowModuleFailure
// CHECK-NOT: some words here

// FILE: main.cjs
try {
  require("./settings.json");
} catch {}

// FILE: settings.json
some words here
