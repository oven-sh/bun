const held = require("node:module");
console.log("_cache", Reflect.getOwnPropertyDescriptor(held, "_cache") !== undefined);
console.log("createRequire", Reflect.getOwnPropertyDescriptor(held, "createRequire") !== undefined);
console.log("nothingOfTheKind", Reflect.getOwnPropertyDescriptor(held, "nothingOfTheKind") !== undefined);
console.log("end");
