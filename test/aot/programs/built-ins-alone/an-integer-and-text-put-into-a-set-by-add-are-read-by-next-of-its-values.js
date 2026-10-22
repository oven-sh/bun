const held = new Set();
held.add(7);
held.add("text");
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value.length);
console.log(steps.next().value === undefined);
