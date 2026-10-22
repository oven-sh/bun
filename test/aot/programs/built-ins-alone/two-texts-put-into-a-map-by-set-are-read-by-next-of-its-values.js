const held = new Map();
held.set("a", "text");
held.set("b", "more text");
const steps = held.values();
console.log(steps.next().value.length, steps.next().value.length);
