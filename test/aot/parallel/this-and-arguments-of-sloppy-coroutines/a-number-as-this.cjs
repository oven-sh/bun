function* relay() { yield 1; return typeof this; }
const steps = relay.call(5);
steps.next();
console.log(steps.next().value);
