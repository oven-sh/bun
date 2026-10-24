// `if (!module.parent)`: the way a file of a package tells whether it was started or required. The file that requires it exports nothing, so nothing else makes the compiler keep an object for it.
require("./library.cjs");
require("./started-or-required.cjs").report();
console.log("main.cjs:", module.parent ? "required" : "started");
