// The arrow function has the `this` of the sloppy function around it.
const whole = (function () { return () => this; })()();
console.log(Bun.inspect(whole, { depth: 3 }).length > 100);
