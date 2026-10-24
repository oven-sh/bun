function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function make(tag) { function Meter() { this.made = tag; this[tag] = 1; } return class Fine extends Meter { extra = tag; }; }
const A = make("a"), B = make("b");
console.log(show(new A()), show(new B()), new A() instanceof B, Object.getPrototypeOf(A) === Object.getPrototypeOf(B));
