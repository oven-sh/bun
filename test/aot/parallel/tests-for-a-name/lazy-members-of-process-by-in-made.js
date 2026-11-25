for (const word of JSON.parse("[\"allowedNodeEnvironmentFlags\", \"finalization\", \"nextTick\", \"argv\", \"nothingOfTheKind\"]")) console.log(word, word in process);
console.log("end");
