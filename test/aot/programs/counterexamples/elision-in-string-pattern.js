// An elision in an array pattern steps the iterator: `[, b]` of "xy" is "y".
console.log((([, b]) => b)("xy"));
