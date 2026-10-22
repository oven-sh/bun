const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.unicodeSets;
console.log(typeof result, result);
