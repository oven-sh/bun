const held = new Set([1.5, 2.5]);
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
console.log(steps.next().value === undefined);
