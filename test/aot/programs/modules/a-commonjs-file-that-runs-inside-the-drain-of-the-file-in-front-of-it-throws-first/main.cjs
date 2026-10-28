// import() loads a module beside another import(). The module imports two CommonJS files that throw, and the first one calls drainMicrotasks() of bun:jsc before it does: the second file runs inside that call, so its error is the first.
require("./lines.cjs");
track("root", import("./root.mjs"));
track("other", import("./other.mjs"));
