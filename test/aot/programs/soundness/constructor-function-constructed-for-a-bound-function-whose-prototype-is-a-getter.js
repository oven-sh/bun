// A constructor function is constructed for a function bound twice whose `prototype` is a getter: the getter runs, its answer lies above what is made, and the constructor's own store is there too.
function Legacy() { this.own = 1; }
const bound = function () {}.bind().bind();
Object.defineProperty(bound, "prototype", { get() { return { peek() { return "peeked"; } }; } });
const made = Reflect.construct(Legacy, [], bound);
console.log(made.peek(), made.own, made instanceof Legacy);
