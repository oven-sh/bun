for (const word of JSON.parse("[\"allowedNodeEnvironmentFlags\", \"finalization\", \"nextTick\", \"argv\", \"nothingOfTheKind\"]")) console.log(word, Object.prototype.hasOwnProperty.call(process, word));
console.log("end");
