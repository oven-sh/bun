const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = "".matchAll(first);
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value === undefined, [...result].length);
