for (const word of JSON.parse("[\"allowedNodeEnvironmentFlags\", \"finalization\", \"nextTick\", \"argv\", \"nothingOfTheKind\"]")) console.log(word, Object.getOwnPropertyDescriptor(process, word) !== undefined);
console.log("end");
