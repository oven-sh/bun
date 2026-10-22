const held = new Map(Object.entries({ a: 7, b: 1.5 }));
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
