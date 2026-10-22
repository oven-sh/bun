const held = [0, 1].map(index => (index === 0 ? 7 : 1.5));
const steps = held.values();
console.log(steps.next().value + 1, steps.next().value + 1);
