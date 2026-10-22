const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.lastIndex;
console.log(typeof result, result + 1, 1 / result);
