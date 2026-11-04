// Three files require one file, whose first two runs throw. A require() that throws leaves no child, neither of the file that called nor of the one above it.
const { basename } = require("node:path");
const name = module => module && basename(module.filename);
for (const file of ["./first.cjs", "./second.cjs", "./third.cjs"]) {
  try {
    require(file);
  } catch (e) {
    console.log(file + " threw " + e.message);
  }
  if (file === "./second.cjs") globalThis.succeed = true;
}
console.log(globalThis.parents.map(name).join());
console.log(module.children.map(name).join());
console.log(module.children.map(child => name(child) + ": " + child.children.map(name).join()).join(" | "));
