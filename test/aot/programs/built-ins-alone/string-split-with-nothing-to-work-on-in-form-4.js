const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = "".split(first, 2);
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
