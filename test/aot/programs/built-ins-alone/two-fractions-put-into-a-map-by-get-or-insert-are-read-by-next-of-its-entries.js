const held = new Map();
held.getOrInsert("a", 1.5);
held.getOrInsert("b", 2.5);
const steps = held.entries();
console.log(steps.next().value[1] + 1, steps.next().value[1] + 1);
