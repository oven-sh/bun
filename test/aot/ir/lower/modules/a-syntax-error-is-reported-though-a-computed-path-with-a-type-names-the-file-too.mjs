// `import("./" + name, { with: { type: "json" } })` may name every file beside it. Each used to be read as JSON too, and as JSON a file of code fails where it is loaded.
// What is said of that form was dropped by the path of the file, which the file itself shares: its own syntax error went with it, and the build ended in an internal error.
// RUN: lower
// DIAGNOSTIC: TS1134 part.mjs:1
// DIAGNOSTIC: TS100088 main.mjs:2

// FILE: main.mjs
import "./part.mjs";
import("./" + process.argv[2], { with: { type: "json" } });

// FILE: part.mjs
const = 1;
