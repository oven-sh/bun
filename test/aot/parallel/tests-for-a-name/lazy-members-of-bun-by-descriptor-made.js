for (const word of JSON.parse("[\"$\", \"SQL\", \"postgres\", \"sql\", \"semver\", \"nothingOfTheKind\"]")) console.log(word, Object.getOwnPropertyDescriptor(Bun, word) !== undefined);
console.log("end");
