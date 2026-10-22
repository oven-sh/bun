const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = "".replaceAll(first, 2.5);
console.log(typeof result, result.length, result);
