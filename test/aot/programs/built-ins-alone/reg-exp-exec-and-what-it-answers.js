const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.exec("an");
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result[1], result[1].length, result[1]);
console.log(typeof result[2], result[2].length, result[2], typeof result[3], result[3] === undefined);
console.log(typeof result.index, result.index + 1, 1 / result.index);
console.log(typeof result.input, result.input.length, result.input, typeof result.groups, Object.keys(result.groups).join());
console.log(typeof result.groups.rest, result.groups.rest.length, result.groups.rest, typeof result.groups.none, result.groups.none === undefined);
