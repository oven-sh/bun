// import() loads a module that imports two CommonJS files that throw. The first calls import() and drainMicrotasks() of bun:jsc before it does: the second runs inside the drain, so the load is rejected with its error. The lines are sorted.
require("./lines.cjs");
track("root", import("./root.mjs"));
