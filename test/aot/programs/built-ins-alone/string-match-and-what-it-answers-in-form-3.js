const result = "banana".match("an");
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result.index, result.index + 1, typeof result.input, result.input.length, result.input);
console.log(typeof result.groups, result.groups === undefined);
