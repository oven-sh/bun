const map = new Map([["first", 1], ["second", 2]]);
const result = map.keys();
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value.length, step.value, [...result].length);
