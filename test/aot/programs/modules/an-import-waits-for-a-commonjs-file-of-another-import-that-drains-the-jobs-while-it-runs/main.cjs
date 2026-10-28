// Two calls of import(), one behind the other. The first module imports two CommonJS files, and the second of them calls drainMicrotasks() of bun:jsc before it exports a name. The other module takes that name: its load waits for the end of the file.
require("./lines.cjs");
track("first", import("./first.mjs"));
track("second", import("./second.mjs"));
