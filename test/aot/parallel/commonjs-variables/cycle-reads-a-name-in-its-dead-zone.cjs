const a = require("./lib-cycle-a.cjs");
console.log(a.other.tries.join(), a.other.again().join());
