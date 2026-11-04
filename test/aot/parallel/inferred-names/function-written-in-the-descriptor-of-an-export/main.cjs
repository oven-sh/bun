const { plain, arrow, made, own } = require("./defines.cjs");
const { onModule } = require("./defines-on-module-exports.cjs");
const { onThis } = require("./defines-on-this.cjs");
const { byReflect } = require("./defines-by-reflect.cjs");
console.log([plain, arrow, made, own, onModule, onThis, byReflect].map(it => JSON.stringify(it.name)).join(" "));
