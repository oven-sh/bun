const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.source;
console.log(typeof result, result.length, result);
