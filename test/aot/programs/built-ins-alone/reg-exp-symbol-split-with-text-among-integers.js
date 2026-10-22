const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern[Symbol.split]("an", "text");
console.log(Array.isArray(result), result.length);
