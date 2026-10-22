const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = "".search(first);
console.log(typeof result, result + 1);
