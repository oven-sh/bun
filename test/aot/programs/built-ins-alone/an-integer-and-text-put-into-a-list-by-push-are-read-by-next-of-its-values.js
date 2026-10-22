const held = [];
held.push(7);
held.push("text");
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value.length);
