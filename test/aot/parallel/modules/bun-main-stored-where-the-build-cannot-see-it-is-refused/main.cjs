// Alone: which file is the main module goes by the entry points of the executable
// Env: KEY=main
// The build sees a store on Bun under a key that it cannot read, so it counts on no member of Bun that a program may replace. The store is taken, and all that names the main module follows it, as under `bun run`.
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
stored
other.cjs other.cjs false true
what is there already is stored again
another name: other.cjs
*/
