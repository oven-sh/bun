const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.sticky;
console.log(typeof result, result);
