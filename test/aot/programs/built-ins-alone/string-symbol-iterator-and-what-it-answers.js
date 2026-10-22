const result = "banana"[Symbol.iterator]();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value.length, step.value, [...result].length);
