// A function is compared with what objects hold under its name: itself, a bound copy, another function of that name, nothing, a proxy. And closures of one function, methods and static methods with each other.
function emit() { return 1; }
const a = { emit };
function same(o) { return o.emit === emit; }
console.log(same(a), same({ emit: emit.bind(null) }), same({ emit: function emit() {} }), same({}), same({ emit: new Proxy(emit, {}) }));
function make() { return function inner() {}; }
const i1 = make(); function isI1(x) { return x === i1; }
console.log(isI1(i1), isI1(make()), isI1(null));
function once() { return function single() { return 2; }; }
const s1 = once(); console.log(s1 === s1, [s1].includes(s1), s1 === once());
class K { m() {} static s() {} }
console.log(new K().m === K.prototype.m, new K().m === new K().m, K.s === K.s, (() => {}) === (() => {}));
