// import() loads a module that imports a CommonJS file and a module that is not there. The file calls import() twice and drainMicrotasks() of bun:jsc; what it imports imports the file, and a file that throws or a module that is not there: every load is rejected with its own error.
require("./lines.cjs");
track("root", import("./root.mjs"));
