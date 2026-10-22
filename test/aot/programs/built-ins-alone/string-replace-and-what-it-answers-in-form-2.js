const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = "banana".replace(first, "-");
console.log(typeof result, result.length, result);
