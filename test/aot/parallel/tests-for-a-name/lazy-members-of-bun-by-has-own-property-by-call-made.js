for (const word of JSON.parse("[\"$\", \"SQL\", \"postgres\", \"sql\", \"semver\", \"nothingOfTheKind\"]")) console.log(word, Object.prototype.hasOwnProperty.call(Bun, word));
console.log("end");
