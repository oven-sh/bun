// No row lists this event: the row for every event takes the call.
process.on("made-up", (first, second) => console.log(first.size, second instanceof Map, [...second.keys()].join()));
process.emit("made-up", new Set([1, 2]), new Map([["a", 1]]));
