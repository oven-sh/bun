const held = require("node:module");
console.log("_cache", Object.getOwnPropertyDescriptor(held, "_cache") !== undefined);
console.log("createRequire", Object.getOwnPropertyDescriptor(held, "createRequire") !== undefined);
console.log("nothingOfTheKind", Object.getOwnPropertyDescriptor(held, "nothingOfTheKind") !== undefined);
console.log("end");
