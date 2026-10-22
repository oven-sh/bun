const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = "".replace(first, 2.5);
console.log(typeof result, result.length, result);
