const held = require("node:module");
console.log("_cache", Object.hasOwn(held, "_cache"));
console.log("createRequire", Object.hasOwn(held, "createRequire"));
console.log("nothingOfTheKind", Object.hasOwn(held, "nothingOfTheKind"));
console.log("end");
