// RUN: link
// OPTIONS: builtin-modules
// CHECK: function {{*}}name="callbackifyOnRejected"

// FILE: main.js
import util from "node:util";
process.stdout.write(String(Object.values(util).length > 10) + "\n");
