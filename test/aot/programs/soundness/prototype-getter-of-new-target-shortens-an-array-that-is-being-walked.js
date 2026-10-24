function F() {}
const list = [1, 2, 3, 4];
const seen = [];
class B extends F { constructor() { let first = true; list.forEach(x => { seen.push(x); if (first) { first = false; super(); } }); } }
const T = function () {}.bind(null);
Object.defineProperty(T, "prototype", { get() { list.length = 2; return B.prototype; } });
Reflect.construct(B, [], T);
console.log(seen.join(), list.length);
