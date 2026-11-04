// `c.n++` below `Counter.prototype.n = 0`: later an object that converts is stored on the prototype in the place of the number. An object with an n of its own keeps counting, any other converts what lies above, once for each first update
function Counter(id) { this.id = id; }
Counter.prototype.n = 0;
function bump(c) { c.n++; return c.n; }
let log = "";
function deed() { Counter.prototype.n = { valueOf() { log += "v"; return 70; } }; }
const old = new Counter(1);
const late = new Counter(2);
console.log(bump(old), bump(old), late.n);
deed();
console.log(bump(old), typeof late.n, bump(late), bump(late), log, Object.keys(late).join());
for (let turn = 0; turn < 300; turn++) {
    bump(old);
    bump(new Counter(turn));
}
console.log(old.n, late.n, log.length, typeof new Counter(3).n, typeof Counter.prototype.n);
