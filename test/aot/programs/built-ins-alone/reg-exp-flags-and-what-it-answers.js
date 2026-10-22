const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.flags;
console.log(typeof result, result.length, result);
