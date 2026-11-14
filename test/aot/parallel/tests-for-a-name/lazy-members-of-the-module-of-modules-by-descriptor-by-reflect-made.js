const held = require("node:module");
for (const word of JSON.parse("[\"_cache\", \"createRequire\", \"nothingOfTheKind\"]")) console.log(word, Reflect.getOwnPropertyDescriptor(held, word) !== undefined);
console.log("end");
