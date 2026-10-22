const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.toString();
console.log(typeof result, result.length, result);
