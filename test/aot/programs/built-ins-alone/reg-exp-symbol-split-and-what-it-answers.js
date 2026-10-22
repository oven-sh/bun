const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern[Symbol.split]("an", 2.5);
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result[1], result[1].length, result[1]);
