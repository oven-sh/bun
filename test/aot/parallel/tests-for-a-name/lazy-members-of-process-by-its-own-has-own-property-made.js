for (const word of JSON.parse("[\"allowedNodeEnvironmentFlags\", \"finalization\", \"nextTick\", \"argv\", \"nothingOfTheKind\"]")) console.log(word, process.hasOwnProperty(word));
console.log("end");
