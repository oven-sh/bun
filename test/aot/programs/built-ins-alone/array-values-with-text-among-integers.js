const list = [1, 2, 3];
const result = list.values();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value + 1, [...result].length);
