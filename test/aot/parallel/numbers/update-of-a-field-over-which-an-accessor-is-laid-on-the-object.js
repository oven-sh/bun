// `c.n++` below `Counter.prototype.n = 0`: an accessor is laid over the object's own n, and is deleted again. The getter and the setter run once for each update, and behind the deletion the number above is found
function Counter(id) { this.id = id; }
Counter.prototype.n = 0;
function bump(c) { c.n++; return c.n; }
let log = "";
function deed(c) { Object.defineProperty(c, "n", { get() { log += "g"; return 7; }, set(value) { log += "s" + value; }, configurable: true, enumerable: true }); }
const one = new Counter(1);
console.log(bump(one), bump(one));
for (let turn = 0; turn < 300; turn++)
    bump(one);
console.log(one.n, Object.keys(one).join());
deed(one);
console.log(bump(one), bump(one), log, Object.keys(one).join());
delete one.n;
console.log(one.n, bump(one), bump(one), log, Object.keys(one).join());
const two = new Counter(2);
deed(two);
console.log(bump(two), log, Object.keys(two).join());
