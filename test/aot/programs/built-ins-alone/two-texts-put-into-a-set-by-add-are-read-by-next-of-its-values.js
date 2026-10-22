const held = new Set();
held.add("text");
held.add("more text");
const steps = held.values();
console.log(steps.next().value.length, steps.next().value.length);
console.log(steps.next().value === undefined);
