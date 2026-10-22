const held = [];
held[0] = 7;
held[1] = 1.5;
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
