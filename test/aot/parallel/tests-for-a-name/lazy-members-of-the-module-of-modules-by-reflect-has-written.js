const held = require("node:module");
console.log("_cache", Reflect.has(held, "_cache"));
console.log("createRequire", Reflect.has(held, "createRequire"));
console.log("nothingOfTheKind", Reflect.has(held, "nothingOfTheKind"));
console.log("end");
