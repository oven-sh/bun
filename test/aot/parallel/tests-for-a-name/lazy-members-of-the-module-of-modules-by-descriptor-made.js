const held = require("node:module");
for (const word of JSON.parse("[\"_cache\", \"createRequire\", \"nothingOfTheKind\"]")) console.log(word, Object.getOwnPropertyDescriptor(held, word) !== undefined);
console.log("end");
