const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern[Symbol.replace]("an", "-");
console.log(typeof result, result.length, result);
