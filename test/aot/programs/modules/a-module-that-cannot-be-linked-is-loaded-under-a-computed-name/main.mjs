// A package that need not be installed: a module imports it by a static import, and the program reaches that module only by a load that it guards. The build goes through, and the load fails as in plain Bun.
// Under a name that is put together at run time, beside a module that is whole.
const say = e => console.log(e.name, e.code, e.specifier);
const pick = name => import("./" + name + ".mjs");
await pick(["bro", "ken"].join("")).catch(say);
console.log((await pick("fine")).fine);
