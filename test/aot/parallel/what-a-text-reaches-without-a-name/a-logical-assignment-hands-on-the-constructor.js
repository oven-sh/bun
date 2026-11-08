// A logical assignment answers with what it read.
const held = () => 1;
const make = (held.constructor ||= null);
console.log(make("return Bun.inspect({ a: 1 })")());
