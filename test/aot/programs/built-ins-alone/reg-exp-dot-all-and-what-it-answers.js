const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.dotAll;
console.log(typeof result, result);
