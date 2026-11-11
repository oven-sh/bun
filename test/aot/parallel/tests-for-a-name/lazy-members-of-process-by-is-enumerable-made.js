for (const word of JSON.parse("[\"allowedNodeEnvironmentFlags\", \"finalization\", \"nextTick\", \"argv\", \"nothingOfTheKind\"]")) console.log(word, Object.prototype.propertyIsEnumerable.call(process, word));
console.log("end");
