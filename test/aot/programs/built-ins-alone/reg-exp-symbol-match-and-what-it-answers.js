const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern[Symbol.match]("an");
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
