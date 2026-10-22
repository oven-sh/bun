// `new` on a function that the compiler does not know at the site reads new.target's prototype property each time: another object stored there, a value that is no object, a proxy, a bound function,
// a derived class and Reflect.construct all show in the object that is made.
function Node(kind) { this.kind = kind; }
function Token(kind) { this.kind = kind; }
const makers = [Node, Token];
function make(i) { return new makers[i & 1](i); }
let sum = 0;
for (let i = 0; i < 20000; i++) sum += Object.getPrototypeOf(make(i)) === makers[i & 1].prototype ? 1 : 0;
console.log(sum);
const first = Node.prototype;
Node.prototype = { tag: "second" };
console.log(make(0).tag, Object.getPrototypeOf(make(0)) === first, make(1).tag);
Node.prototype = 5;
console.log(Object.getPrototypeOf(make(0)) === Object.prototype);
Node.prototype = first;
console.log(Object.getPrototypeOf(make(0)) === first);
Bun.gc(true);
console.log(Object.getPrototypeOf(make(0)) === first, Object.getPrototypeOf(make(1)) === Token.prototype);
Token.extra = 1;
console.log(Object.getPrototypeOf(make(1)) === Token.prototype);
let reads = 0;
const target = new Proxy(function () {}, { get(t, k) { if (k === "prototype") reads++; return Reflect.get(t, k); } });
for (let i = 0; i < 3; i++) Reflect.construct(Node, [1], target);
console.log(reads);
const bound = Node.bind(null);
console.log(Object.getPrototypeOf(new bound(1)) === first);
class Derived extends Node { constructor() { super(3); } }
console.log(Object.getPrototypeOf(new Derived()) === Derived.prototype, new Derived().kind);
console.log(Object.getPrototypeOf(Reflect.construct(Node, [1], Token)) === Token.prototype);
