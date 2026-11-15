// Built-in functions that are JavaScript of the engine, in a program that hands none of them out: they refuse the names that calls look up, as native ones do.
const ask = test => { try { return String(test()); } catch (error) { return error.constructor.name; } };
console.log(ask(() => { Array.prototype.map.bind = 3; return "stored"; }), typeof Array.prototype.map.bind);
console.log(ask(() => { "use strict"; Reflect.get.call = () => 1; return "stored"; }), typeof Reflect.get.call);
console.log(ask(() => { Object.defineProperty(Array.prototype.reduce, "apply", { value: 3 }); return "defined"; }), typeof Array.prototype.reduce.apply);
console.log(ask(() => Object.assign(Array.from, { call: 4 }) === Array.from), typeof Array.from.call);
console.log(ask(() => Reflect.set(Array.prototype.at, "bind", 5)), typeof Array.prototype.at.bind);
console.log(ask(() => Reflect.defineProperty(Map.prototype.forEach, "call", { get() { return 6; } })), typeof Map.prototype.forEach.call);
console.log(ask(() => { Iterator.from.apply ??= 7; return "kept"; }), typeof Iterator.from.apply);
console.log(ask(() => { Array.prototype.filter["call"] = 8; return "stored"; }), typeof Array.prototype.filter.call, typeof [].filter.call);
console.log(ask(() => { Reflect.apply.bind = 9; return "stored"; }), typeof Reflect.apply.bind);
// Other names.
Array.prototype.some.extra = 1;
Array.prototype.every.toString = () => "mine";
console.log(Array.prototype.some.extra, String(Array.prototype.every));
console.log([1, 2].map(x => x + 1).join(), Reflect.get({ a: 5 }, "a"), Array.from("ab").join(), [[3]].at(0)[0]);
/* Output:
TypeError function
TypeError function
TypeError function
TypeError function
false function
false function
kept function
TypeError function function
TypeError function
1 mine
2,3 5 a,b 3
*/
