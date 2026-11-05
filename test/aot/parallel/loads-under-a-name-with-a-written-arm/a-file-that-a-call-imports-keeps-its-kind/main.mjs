// The name of the load is chosen at run time, and the executable holds no file for it: it says so. `bun <file>` loads setup.cjs and prints "strict |  [object Module]", as a compiled executable does where the name is written outright; `bun build --compile` prints "sloppy | default [object Module]".
let told;
try {
  const loaded = await import(process.env.MADE_UP_SETUP || "./setup.cjs");
  told = globalThis.madeUpKind + " | " + Object.keys(loaded).join(",") + " " + Object.prototype.toString.call(loaded);
} catch (error) {
  told = "not loaded";
}
console.log(told);
/* Output:
not loaded
*/
