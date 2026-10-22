const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = "banana".replaceAll(first, "text");
console.log(typeof result, result.length, result);
