// SIZE lines of one file each say `load ??= createRequire(__filename)`, and every fourth calls `load("node:path")`. Whether every store to `load` is a require of the file is a question about the
// name. Asked anew at every call, several times, walking every store, 375 | 750 | 1,500 lines that each stored and called took 9.7 | 18.6 | 53.8 G instructions.
// It writes a program: SIZE says how large, PASSES how many copies of its function under names of their own.
// Sizes: 500 1000 2000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 8),
  copies = Number(process.env.PASSES ?? 1);
const out = [`const { createRequire } = require("node:module");`, "let found = 0;"];
for (let copy = 0; copy < copies; copy++) {
  out.push(`let load${copy};`, `function run${copy}() {`);
  for (let at = 0; at < size; at++) {
    out.push(`  load${copy} ??= createRequire(__filename);`);
    if (at % 4 === 0) out.push(`  if (load${copy}("node:path").sep) found++;`);
  }
  out.push("}", `run${copy}();`);
}
out.push("console.log(found);");
console.log(out.join("\n"));
