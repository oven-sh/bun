const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = "".match(first);
console.log(result === null);
