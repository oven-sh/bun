const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = RegExp(first, undefined);
console.log(result === first);
