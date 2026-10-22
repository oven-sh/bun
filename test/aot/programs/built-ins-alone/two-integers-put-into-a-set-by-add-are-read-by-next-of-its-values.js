const held = new Set();
held.add(7);
held.add(8);
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
console.log(steps.next().value === undefined);
