// The name of the load is chosen at run time, and the executable holds no file for it: it says so. `bun <file>` loads plug.mjs and prints "sloppy | default [object Module]". No build may print another kind for plain.cjs.
let told;
try {
  const plug = require(process.env.MADE_UP_PLUG || "./plug.mjs");
  told = plug.kind + " | " + plug.shape;
} catch (error) {
  told = "not loaded";
}
console.log(told);
/* Output:
not loaded
*/
