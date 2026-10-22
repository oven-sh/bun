const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = "banana".match(first);
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result[1], result[1].length, result[1]);
console.log(typeof result[2], result[2].length, result[2]);
