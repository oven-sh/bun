const held = new Array(2).fill(1.5).with(1, 2.5);
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
