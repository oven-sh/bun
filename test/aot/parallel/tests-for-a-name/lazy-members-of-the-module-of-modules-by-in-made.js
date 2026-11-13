const held = require("node:module");
for (const word of JSON.parse("[\"_cache\", \"createRequire\", \"nothingOfTheKind\"]")) console.log(word, word in held);
console.log("end");
