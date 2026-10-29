// require() of a text file answers its namespace, bun: + the name of a Node.js module is that module, and a namespace object takes __esModule.
const text = require("./a.txt");
console.log(Object.keys(text).join(), typeof text.default, text.default.trim());
console.log(require("bun:crypto") === require("node:crypto"));
