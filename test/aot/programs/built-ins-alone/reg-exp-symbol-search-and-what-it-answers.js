const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern[Symbol.search]("an");
console.log(typeof result, result + 1, 1 / result);
