for (const word of JSON.parse("[\"$\", \"SQL\", \"postgres\", \"sql\", \"semver\", \"nothingOfTheKind\"]")) console.log(word, Reflect.has(Bun, word));
console.log("end");
