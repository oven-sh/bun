const held = new Map().set("a", 1.5).set("b", 2.5);
const steps = held.entries();
console.log(steps.next().value[1] + 1, steps.next().value[1] + 1);
