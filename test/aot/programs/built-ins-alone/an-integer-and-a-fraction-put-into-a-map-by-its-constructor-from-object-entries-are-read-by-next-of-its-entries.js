const held = new Map(Object.entries({ a: 7, b: 1.5 }));
const steps = held.entries();
console.log(steps.next().value[1] + 1, steps.next().value[1] + 1);
