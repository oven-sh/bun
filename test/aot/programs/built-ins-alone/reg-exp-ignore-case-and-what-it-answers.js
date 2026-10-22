const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.ignoreCase;
console.log(typeof result, result);
