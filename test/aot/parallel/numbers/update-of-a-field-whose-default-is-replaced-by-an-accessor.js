// `c.n++` below `Counter.prototype.n = 0`: later an accessor is laid on the prototype in the place of the number. An object with an n of its own keeps counting, and for any other the getter and the setter above run and no property is created
function Counter(id) { this.id = id; }
Counter.prototype.n = 0;
function bump(c) { c.n++; return c.n; }
let log = "";
function deed() { Object.defineProperty(Counter.prototype, "n", { get() { log += "g"; return 7; }, set(value) { log += "s" + value; }, configurable: true }); }
const old = new Counter(1);
const late = new Counter(2);
console.log(bump(old), bump(old), late.n);
deed();
console.log(bump(old), bump(late), bump(late), log, Object.keys(old).join(), Object.keys(late).join());
log = "";
for (let turn = 0; turn < 300; turn++) {
    bump(old);
    bump(late);
}
console.log(old.n, log.length, Object.keys(late).join());
delete old.n;
log = "";
console.log(bump(old), log, Object.keys(old).join());
