// `require.main` is the only way to a module object that this program names: no file spells `module`. Who required whom shows behind it all the same:
// the children of the main file, theirs, and the parent of each. The list was empty, in silence, where the build took it that nobody asks.
const a = require("./a.cjs");
console.log(a.report().join(" | "));
const b = require("./b.cjs");
console.log(a.report().join(" | "), b.name);
