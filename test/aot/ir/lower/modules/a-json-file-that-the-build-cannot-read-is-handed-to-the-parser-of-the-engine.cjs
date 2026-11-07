// An executable holds no file that the loader could read again when the load fails: the text goes along, and the body of the module hands it to JSON.parse, which throws what `bun <file>` throws.
// The build warns of the text.
// DIAGNOSTIC: Build 1
// RUN: link
// CHECK: [[text]] = String string="some words here{{*}}
// CHECK: Call {{*}}[[text]]
// CHECK: ThrowModuleFailure

// FILE: main.cjs
try {
  require("./settings.json");
} catch {}

// FILE: settings.json
some words here
