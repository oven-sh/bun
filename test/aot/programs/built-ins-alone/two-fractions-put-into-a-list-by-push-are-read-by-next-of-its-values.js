const held = [];
held.push(1.5);
held.push(2.5);
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
