function Meter() { this.n = 1; }
Meter.prototype = null;
function use() { let out = ""; for (let i = 0; i < 300; i++) out = [Object.getPrototypeOf(Reflect.construct(Meter, [], Meter)) === Object.prototype, Object.getPrototypeOf(Reflect.construct(Object, [], Meter)) === Object.prototype, Object.getPrototypeOf(Reflect.construct(Array, [], Meter)) === Array.prototype].join(); return out; }
console.log(use());
