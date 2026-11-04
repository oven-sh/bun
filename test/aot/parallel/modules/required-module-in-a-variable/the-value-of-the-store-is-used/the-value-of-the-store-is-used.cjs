var lib, same;
same = lib = require("./lib.cjs");
console.log(same === lib, same.name, Object.keys(same).join());
