const held = new Map();
held.getOrInsertComputed("a", () => 7);
held.getOrInsertComputed("b", () => 1.5);
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
