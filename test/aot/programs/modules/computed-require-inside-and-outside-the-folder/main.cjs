// A computed require() or import() loads the module of the executable that its value names: one under the folder that the constant part names, and one that the value reaches by climbing out of that folder, whose exports have other types. A specifier that is one of two constants loads one of two modules. A value that names nothing throws as in plain Bun.
const other = require("./other.cjs");

function load(name) {
  return require("./plugins/" + name + ".cjs");
}
function loadLater(name) {
  return import("./plugins/" + name + ".cjs");
}
function choose(isFirst) {
  return require(isFirst ? "./plugins/first.cjs" : "./plugins/second.cjs");
}
function describe(plugin) {
  return plugin.name + " " + (plugin.size + 1);
}

console.log(describe(load("first")), "|", describe(load("second")), "|", describe(load("nested/third")));
console.log(describe(load("../other")), load("../other") === other);
console.log(describe(load("./first")), load("./first") === load("first"));
console.log(describe(choose(true)), "|", describe(choose(false)), choose(true) === load("first"));
try {
  load("absent");
} catch (error) {
  console.log(error.code);
}
(async () => {
  console.log(describe((await loadLater("second")).default), "|", describe((await loadLater("../other")).default));
  try {
    await loadLater("absent");
  } catch (error) {
    console.log(error.code);
  }
})();
