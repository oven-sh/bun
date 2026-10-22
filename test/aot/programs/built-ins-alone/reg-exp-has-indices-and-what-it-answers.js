const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.hasIndices;
console.log(typeof result, result);
