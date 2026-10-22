const held = new Set();
held.add(1.5);
held.add(undefined);
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value === undefined);
console.log(steps.next().value === undefined);
