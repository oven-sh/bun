const held = new Map();
held.getOrInsert("a", 7);
held.getOrInsert("b", 1.5);
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
