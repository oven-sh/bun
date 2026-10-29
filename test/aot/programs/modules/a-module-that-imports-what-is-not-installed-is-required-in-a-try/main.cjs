// A package that need not be installed: a module imports it by a static import, and the program reaches that module only by a load that it guards. The build goes through, and the load fails as in plain Bun.
// The require throws and the program goes on.
const say = e => console.log(e.name, e.code, e.specifier);
try {
  require("./broken.mjs");
} catch (e) {
  say(e);
}
console.log("goes on");
