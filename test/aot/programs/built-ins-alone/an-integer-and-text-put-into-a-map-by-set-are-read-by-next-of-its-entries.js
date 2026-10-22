const held = new Map();
held.set("a", 7);
held.set("b", "text");
const steps = held.entries();
console.log(steps.next().value[1] + 1, steps.next().value[1].length);
