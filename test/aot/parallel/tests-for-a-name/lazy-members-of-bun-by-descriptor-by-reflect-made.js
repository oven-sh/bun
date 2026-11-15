for (const word of JSON.parse("[\"$\", \"SQL\", \"postgres\", \"sql\", \"semver\", \"nothingOfTheKind\"]")) console.log(word, Reflect.getOwnPropertyDescriptor(Bun, word) !== undefined);
console.log("end");
