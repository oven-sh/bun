const held = [];
Reflect.set(held, 0, 1.5);
Reflect.set(held, 1, 2.5);
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
