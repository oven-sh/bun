const held = require("node:module");
console.log("_cache", "_cache" in held);
console.log("createRequire", "createRequire" in held);
console.log("nothingOfTheKind", "nothingOfTheKind" in held);
console.log("end");
