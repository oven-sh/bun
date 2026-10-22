const held = new Map();
held.set("a", 1.5);
held.set("b", 2.5);
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
