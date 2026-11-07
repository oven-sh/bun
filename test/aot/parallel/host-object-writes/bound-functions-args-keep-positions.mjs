// Targets of the program and of the language, bound without arguments, with arguments, twice, through call and through a spread.
function minus(a, b, c) { return [this === undefined ? "none" : this.tag, a, b, c].join(); }
const holder = { tag: "held" };
const plain = minus.bind(holder);
const withOne = minus.bind(holder, 1);
const twice = minus.bind(holder).bind({ tag: "ignored" });
const throughCall = Function.prototype.bind.call(minus, holder, 7);
const list = [holder, 8, 9];
const spread = minus.bind(...list);
console.log(plain(5, 3), withOne(5, 3), twice(5, 3), throughCall(5, 3), spread(5, 3), plain(), plain(1, 2, 3, 4));
const uncurry = Function.prototype.call.bind(Array.prototype.map);
console.log(uncurry([1, 2, 3], (value, index) => value * 10 + index).join());
const has = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
console.log(has({ a: 1 }, "a"), has({ a: 1 }, "b"));
const push = Array.prototype.push.bind([]);
console.log(push(1), push(2, 3));
const Bound = (function Made(a) { this.a = a; }).bind(null);
console.log(new Bound(4).a);
