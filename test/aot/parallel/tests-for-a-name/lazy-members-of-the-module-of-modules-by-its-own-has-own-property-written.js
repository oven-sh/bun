const held = require("node:module");
console.log("_cache", held.hasOwnProperty("_cache"));
console.log("createRequire", held.hasOwnProperty("createRequire"));
console.log("nothingOfTheKind", held.hasOwnProperty("nothingOfTheKind"));
console.log("end");
