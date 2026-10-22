const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.multiline;
console.log(typeof result, result);
