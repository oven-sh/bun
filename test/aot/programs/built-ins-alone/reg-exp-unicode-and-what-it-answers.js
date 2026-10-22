const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.unicode;
console.log(typeof result, result);
