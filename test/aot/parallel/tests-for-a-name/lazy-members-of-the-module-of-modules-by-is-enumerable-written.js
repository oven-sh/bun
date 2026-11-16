const held = require("node:module");
console.log("_cache", Object.prototype.propertyIsEnumerable.call(held, "_cache"));
console.log("createRequire", Object.prototype.propertyIsEnumerable.call(held, "createRequire"));
console.log("nothingOfTheKind", Object.prototype.propertyIsEnumerable.call(held, "nothingOfTheKind"));
console.log("end");
