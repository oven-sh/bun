const held = new Set();
held.add(1.5);
held.add(2.5);
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
console.log(steps.next().value === undefined);
