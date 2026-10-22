const list = [1, 2, 3];
const result = list.entries();
console.log(typeof result);
const step = result.next();
console.log(step.done, Array.isArray(step.value), step.value.length);
console.log(typeof step.value[0], step.value[0] + 1, 1 / step.value[0], typeof step.value[1], step.value[1] + 1);
console.log([...result].length);
