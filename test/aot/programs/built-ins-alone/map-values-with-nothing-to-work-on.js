const map = new Map();
const result = map.values();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value === undefined, [...result].length);
