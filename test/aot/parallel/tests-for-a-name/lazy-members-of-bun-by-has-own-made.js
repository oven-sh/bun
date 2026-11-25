for (const word of JSON.parse("[\"$\", \"SQL\", \"postgres\", \"sql\", \"semver\", \"nothingOfTheKind\"]")) console.log(word, Object.hasOwn(Bun, word));
console.log("end");
