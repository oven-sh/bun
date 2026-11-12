// Whoever stores to a member of import.meta gets it back.
// RUN: lower
// CHECK-LABEL: function {{*}}name="start"
// CHECK: [[folder]] = PropGet {{*}}key="dir"
// CHECK: [[name]] = Add [[folder]],
// CHECK: Construct {{*}}, -, [[name]] calleeName="Worker"

// FILE: main.mjs
import.meta.dir = import.meta.dir + "/lib";
export const start = function start() { return new Worker(import.meta.dir + "/job.mjs"); };
