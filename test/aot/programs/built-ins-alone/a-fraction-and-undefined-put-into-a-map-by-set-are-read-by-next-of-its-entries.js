const held = new Map();
held.set("a", 1.5);
held.set("b", undefined);
const steps = held.entries();
console.log(steps.next().value[1] + 1, steps.next().value[1] === undefined);
