// `instanceof` asks what the prototype property of a plain function holds now, not what it held when the object was made.
function Meter() {}
function test(value) { return value instanceof Meter; }
const meter = new Meter();
const told = [test(meter), test({}), test(Object.create(Meter.prototype))];
const replaced = {};
Meter.prototype = replaced;
told.push(test(meter), test(Object.create(replaced)), test(new Meter()));
Object.setPrototypeOf(meter, replaced);
told.push(test(meter));
console.log(told.join());
