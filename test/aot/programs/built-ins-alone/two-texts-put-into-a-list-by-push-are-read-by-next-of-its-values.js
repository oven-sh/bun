const held = [];
held.push("text");
held.push("more text");
const steps = held.values();
console.log(steps.next().value.length, steps.next().value.length);
