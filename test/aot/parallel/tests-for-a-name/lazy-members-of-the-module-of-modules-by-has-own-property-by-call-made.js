const held = require("node:module");
for (const word of JSON.parse("[\"_cache\", \"createRequire\", \"nothingOfTheKind\"]")) console.log(word, Object.prototype.hasOwnProperty.call(held, word));
console.log("end");
