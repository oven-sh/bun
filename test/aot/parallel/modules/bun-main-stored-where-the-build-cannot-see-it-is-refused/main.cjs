// Alone: which file is the main module goes by the entry points of the executable
// Env: KEY=main
// No statement that the build sees stores into Bun.main, so the entry point is the main module for good, and the store says so where it would go unheard.
const nameOf = path => String(path).split(/[\\/]/).at(-1);
const other = require("./other.cjs");
try {
  Bun[process.env.KEY] = other.me.filename;
  console.log("stored");
} catch (error) {
  console.log(error.name + ":", error.message);
}
console.log(nameOf(Bun.main), nameOf(require.main.filename), require.main === module, other.isMain());
Bun[process.env.KEY] = Bun.main;
console.log("what is there already is stored again");
Bun.other = other.me.filename;
console.log("another name:", nameOf(Bun.other));
/* Output:
TypeError: Cannot assign to Bun.main because built-in objects are read-only in a compiled executable, and the build didn't see your code assign to this one. Spell out the object and the name where it does, as in Bun.main = value (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
main.cjs main.cjs true false
what is there already is stored again
another name: other.cjs
*/
