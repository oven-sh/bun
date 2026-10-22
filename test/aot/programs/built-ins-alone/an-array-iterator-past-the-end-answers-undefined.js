const steps = [1.5].values();
console.log(steps.next().value + 1);
const last = steps.next();
console.log(last.done, last.value === undefined, typeof last.value);
