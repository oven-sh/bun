const held = new Map();
held.getOrInsertComputed("a", () => 1.5);
held.getOrInsertComputed("b", () => 2.5);
const steps = held.entries();
console.log(steps.next().value[1] + 1, steps.next().value[1] + 1);
