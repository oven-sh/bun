// A require function prints as its name, however the program came by it. Nothing of the cache, the extensions or the main module is shown.
// Flags: --aot-validate
const load = module.require;
console.log(load, require, { load }, [require.resolve]);
console.log(Bun.inspect(load), Object.getPrototypeOf(load) === Function.prototype);
console.log(Object.getPrototypeOf(Object.getPrototypeOf(load)) === Function.prototype, load("node:path").sep.length);
