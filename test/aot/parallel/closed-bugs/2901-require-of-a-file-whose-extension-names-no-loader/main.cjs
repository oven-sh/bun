const load = require;
console.log(JSON.stringify(load("./a.bin")), JSON.stringify(load("./b.conf")));
console.log(JSON.stringify(require("node:module").createRequire(__filename)("./a.bin")));
