// `var __require = import.meta.require;` stands at the top of what `bun build --target=bun` writes. A call of such a binding with a constant name loads
// what `import.meta.require` with that name loads: a module of Bun's or a file of the program, which is in the executable for it.
var __require = import.meta.require;
var again = __require;
function late() {
  const { sep } = again("path");
  return sep;
}
var { createHash } = __require("crypto");
console.log(typeof createHash, late(), __require("./required.cjs").one(), __require("node:os").EOL === "\n" || __require("node:os").EOL === "\r\n");

// Above the statement that fills it a `var` holds undefined, and a constant is in its dead zone.
console.log(typeof early);
try {
  early("fs");
} catch (error) {
  console.log(error.name);
}
var early = import.meta.require;
function throughConstant() {
  return constant("node:path").sep === late();
}
try {
  console.log(throughConstant());
} catch (error) {
  console.log(error.name);
}
const constant = early;
console.log(throughConstant(), typeof early("fs").readFileSync, constant?.("node:url").URL === URL, constant("./required.cjs").one());

// A binding that is stored to again holds whatever it holds.
let changed = import.meta.require;
changed = name => "mine:" + name;
console.log(changed("crypto"));

export const kept = constant("./required.cjs");
console.log(kept === __require("./required.cjs"), Object.keys(kept).join());
