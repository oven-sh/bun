const subject = new URLSearchParams("first=1&second=two&first=3");
const result = subject.entries();
console.log(typeof result);
const step = result.next();
console.log(step.done, Array.isArray(step.value), step.value.length);
console.log(typeof step.value[0], step.value[0].length, step.value[0]);
console.log(typeof step.value[1], step.value[1].length, step.value[1], [...result].length);
