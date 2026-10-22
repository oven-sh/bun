const held = [];
held.push(...[7, 1.5]);
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
