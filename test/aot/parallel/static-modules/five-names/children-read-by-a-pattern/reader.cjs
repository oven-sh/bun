const { y } = require("./child.cjs");
const { children } = module;
const names = list => (Array.isArray(list) ? list.map(child => child.filename.split(/[\\/]/).pop()).join() : String(list));
console.log("children:", names(children));
exports.x = y;
