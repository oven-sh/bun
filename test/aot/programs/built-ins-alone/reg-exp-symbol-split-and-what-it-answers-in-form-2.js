const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern[Symbol.split]("an", "-");
console.log(Array.isArray(result), result.length);
