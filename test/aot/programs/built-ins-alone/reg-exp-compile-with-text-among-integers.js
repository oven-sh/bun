const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.compile("text");
console.log(result === pattern, pattern instanceof RegExp, pattern.source, pattern.flags, pattern.lastIndex);
