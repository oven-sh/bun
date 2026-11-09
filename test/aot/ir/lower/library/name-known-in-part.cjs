// RUN(HELD): link
// RUN(LEFT): link
// RUN(ASKS): lower
// OPTIONS: builtin-modules
// HELD: module {{*}}path="node:punycode" {{*}}body=
// LEFT-NOT: module {{*}}path="node:http2" {{*}}body=
// LEFT-NOT: module {{*}}path="bun:wrap" {{*}}body=
// ASKS-NOT: SwitchString
// ASKS-COUNT-2: = RequireDynamic
// ASKS-NOT: SwitchString

// A part of a name names no module of Bun's, so it brings none in. The text goes to the loader of the host, which refuses a module that the executable lacks.
// The whole name may be one that the program writes out somewhere, so that module is held.

console.log({ kind: "node:punycode" });
module.exports = [require("node:" + process.argv[2]), require("bun:" + process.argv[3])];
