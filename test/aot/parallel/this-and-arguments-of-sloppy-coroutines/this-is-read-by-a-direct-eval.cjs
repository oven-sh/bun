function* relay() { yield 1; return eval("this.held"); }
const steps = relay.call({ held: 12 });
steps.next();
console.log(steps.next().value);
