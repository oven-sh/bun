// RUN: link
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesRuntime >= 90
// CHECK-NOT: function {{*}}name="getHostname"
// CHECK-NOT: function {{*}}name="callbackifyOnRejected"

// What stands behind process.stdout evaluates node:url and node:util too, and reads some of their exports by name: neither is lowered whole.

// FILE: main.js
process.stdout.write("a line\n");
