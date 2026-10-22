const set = new Set([1, 2]);
const result = set.entries();
console.log(typeof result);
const step = result.next();
console.log(step.done, Array.isArray(step.value), step.value.length, typeof step.value[0], step.value[0] + 1);
console.log(typeof step.value[1], step.value[1] + 1, [...result].length);
