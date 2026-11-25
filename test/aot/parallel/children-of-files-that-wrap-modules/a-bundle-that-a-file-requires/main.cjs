// The same where the bundle is another file, and where its functions are asked for by numbers.
"use strict";
const { basename } = require("node:path");
const library = require("./library.cjs");
const names = file => file.children.map(child => basename(child.filename)).join();
console.log(library.value, library.count(), names(module), "[" + names(module.children[0]) + "]");
console.log(library.parent === module, names(library.own));
