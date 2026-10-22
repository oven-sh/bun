const held = [];
held.unshift(2.5);
held.unshift(1.5);
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
