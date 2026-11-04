// class made twice
const name = JSON.parse('"read"');
const hidden = () => globalThis.kept;
const above = o => Object.getPrototypeOf(o);
function make() { return class Meter { read(x) { return "meter " + x; } }; }
const A = make(), B = make();
function once(m) { return m.read(1); }
globalThis.kept = new B();
above(hidden())[name] = x => "b " + x;
console.log(once(new A()), "|", once(new B()), "|", once(globalThis.kept));
