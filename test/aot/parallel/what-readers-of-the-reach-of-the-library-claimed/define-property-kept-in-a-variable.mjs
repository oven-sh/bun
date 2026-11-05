const custom = Symbol.for("nodejs.util.inspect.custom");
const define = Object.defineProperty;
function lay(target, method) { define(target, custom, { value: method }); }
class Money { constructor(n) { this.n = n; } }
lay(Money.prototype, function () { return "$" + this.n; });
console.log(new Money(5));
