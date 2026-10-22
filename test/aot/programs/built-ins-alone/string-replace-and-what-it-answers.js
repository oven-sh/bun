const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = "banana".replace(first, 2.5);
console.log(typeof result, result.length, result);
