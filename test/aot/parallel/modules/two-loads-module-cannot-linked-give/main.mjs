// A package that need not be installed: a module imports it by a static import, and the program reaches that module only by a load that it guards. The build goes through, and the load fails as in plain Bun.
// The second load is rejected with the very object of the first.
let one, two;
await import("./broken.mjs").catch(e => (one = e));
await import("./broken.mjs").catch(e => (two = e));
console.log(one === two, one.name === two.name);
