const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.compile(1.5);
console.log(result === pattern, pattern instanceof RegExp, pattern.source, pattern.flags, pattern.lastIndex);
