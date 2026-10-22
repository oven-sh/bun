const held = Array.from({ length: 2, 0: 1.5, 1: 2.5 });
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
