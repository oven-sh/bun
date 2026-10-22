const held = new Map().set("a", 7).set("b", 1.5);
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
