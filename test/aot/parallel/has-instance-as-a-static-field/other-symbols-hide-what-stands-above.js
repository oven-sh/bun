class Base { static [Symbol.toPrimitive]() { return 1; } static get [Symbol.toStringTag]() { return "base"; } static *[Symbol.iterator]() { yield 1; } static tag() { return "base"; } }
class Heir extends Base { static [Symbol.toPrimitive] = () => 2; static [Symbol.toStringTag] = "heir"; static [Symbol.iterator] = function* () { yield 2; yield 3; }; }
class Third extends Heir { }
console.log(+Base, +Heir, +Third, Object.prototype.toString.call(Heir), Object.prototype.toString.call(Third), [...Base].join(), [...Heir].join(), [...Third].join());
let sum = 0; for (let i = 0; i < 50; i++) sum += +Heir + [...Third].length; console.log(sum);
