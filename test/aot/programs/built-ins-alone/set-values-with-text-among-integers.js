const set = new Set([1, 2]);
const result = set.values();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value + 1, [...result].length);
