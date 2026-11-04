// `c.n++` where n lies on the prototype: the first update creates the field; then the field is deleted, the number above is replaced, and an accessor is laid above
function Counter() { this.id = 1; }
Counter.prototype.n = 0;
function bump(c) { c.n++; return c.n; }
let log = "";
function deed(c) { return bump(c) + " " + Object.keys(c).join(); }
const one = new Counter();
console.log(Object.keys(one).join(), deed(one), deed(one));
for (let turn = 0; turn < 300; turn++) bump(one);
console.log(deed(one), Counter.prototype.n);
delete one.n;
Counter.prototype.n = 50;
console.log(one.n, deed(one), deed(one));
delete one.n;
Object.defineProperty(Counter.prototype, "n", { get() { log += "g"; return 7; }, set(v) { log += "s" + v; }, configurable: true });
console.log(deed(one), deed(one), log);
const two = new Counter();
console.log(deed(two), log, Object.keys(two).join());
