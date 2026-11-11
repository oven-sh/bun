// RUN: link
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesRuntime >= 90
// CHECK-LABEL: function {{*}}name="getHostname"
// CHECK-NOT: Return
// CHECK: NewRuntimeError runtimeError=FunctionNotCompiled
// RUN(UTIL): link
// UTIL-LABEL: function {{*}}name="callbackifyOnRejected"
// UTIL-NOT: Return
// UTIL: NewRuntimeError runtimeError=FunctionNotCompiled

// What stands behind process.stdout evaluates node:url and node:util too, and reads some of their exports by name: neither is lowered whole.

// FILE: main.js
process.stdout.write("a line\n");
