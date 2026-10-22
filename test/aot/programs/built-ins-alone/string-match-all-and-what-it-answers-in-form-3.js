const result = "banana".matchAll("an");
console.log(typeof result);
const step = result.next();
console.log(step.done, Array.isArray(step.value), step.value.length);
console.log(typeof step.value[0], step.value[0].length, step.value[0], typeof step.value.index, step.value.index + 1);
console.log(typeof step.value.input, step.value.input.length, step.value.input, typeof step.value.groups, step.value.groups === undefined);
console.log([...result].length);
