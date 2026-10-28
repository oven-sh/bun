// Two calls of import(), one behind the other. The first module imports two CommonJS files, and the second of them calls drainMicrotasks() of bun:jsc and then throws. The other module imports that file alone: both calls are rejected with its error.
require("./lines.cjs");
track("first", import("./first.mjs"));
track("second", import("./second.mjs"));
