const held = new Map(Object.entries({ a: 1.5, b: 2.5 }));
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
