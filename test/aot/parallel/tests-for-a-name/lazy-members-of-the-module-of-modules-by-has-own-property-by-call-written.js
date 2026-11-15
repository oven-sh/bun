const held = require("node:module");
console.log("_cache", Object.prototype.hasOwnProperty.call(held, "_cache"));
console.log("createRequire", Object.prototype.hasOwnProperty.call(held, "createRequire"));
console.log("nothingOfTheKind", Object.prototype.hasOwnProperty.call(held, "nothingOfTheKind"));
console.log("end");
