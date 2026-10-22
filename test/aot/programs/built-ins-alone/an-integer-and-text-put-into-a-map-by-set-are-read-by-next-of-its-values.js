const held = new Map();
held.set("a", 7);
held.set("b", "text");
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value.length);
