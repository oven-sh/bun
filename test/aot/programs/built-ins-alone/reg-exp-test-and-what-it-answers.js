const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.test("an");
console.log(typeof result, result);
