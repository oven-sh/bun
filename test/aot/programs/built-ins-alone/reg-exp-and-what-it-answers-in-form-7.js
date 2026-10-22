const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = new RegExp(first, undefined);
console.log(result instanceof RegExp, result.source, result.flags, result.lastIndex);
