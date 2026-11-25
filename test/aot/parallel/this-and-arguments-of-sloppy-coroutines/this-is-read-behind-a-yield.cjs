function* relay() { yield arguments.length; return this === globalThis; }
const steps = relay(4, 5);
console.log(steps.next().value, steps.next().value);
