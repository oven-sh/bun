const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.global;
console.log(typeof result, result);
