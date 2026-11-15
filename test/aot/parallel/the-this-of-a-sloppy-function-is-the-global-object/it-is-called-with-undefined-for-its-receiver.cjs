// The receiver is written, and is undefined.
const whole = (function () { return this; }).call(undefined);
console.log(Bun.inspect(whole, { depth: 3 }).length > 100);
