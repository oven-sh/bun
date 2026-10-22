const held = new Map();
held.set("a", "text");
held.set("b", "more text");
const steps = held.entries();
console.log(steps.next().value[1].length, steps.next().value[1].length);
