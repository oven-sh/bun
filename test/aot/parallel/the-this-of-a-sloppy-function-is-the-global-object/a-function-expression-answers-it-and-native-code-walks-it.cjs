// Native code walks whatever the global object leads to: nothing of that may have been left out. No operation of the program spells the global object here.
const whole = (function () { return this; })();
console.log(Bun.inspect(whole, { depth: 3 }).length > 100);
