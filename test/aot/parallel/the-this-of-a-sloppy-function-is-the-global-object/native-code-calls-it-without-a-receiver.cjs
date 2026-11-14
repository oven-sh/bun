// Array.prototype.map calls it without a receiver.
const whole = [1].map(function () { return this; })[0];
console.log(Bun.inspect(whole, { depth: 3 }).length > 100);
