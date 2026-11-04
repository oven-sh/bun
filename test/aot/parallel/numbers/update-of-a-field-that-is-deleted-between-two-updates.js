// `c.n++` below `Counter.prototype.n = 0`: the object's own n is deleted between two updates, so the next read finds the number above again
function Counter(id) { this.id = id; }
Counter.prototype.n = 0;
function bump(c) { c.n++; return c.n; }
function deed(c) { delete c.n; return c.n + " " + bump(c) + " " + Object.keys(c).join(); }
const one = new Counter(1);
console.log(Object.keys(one).join(), bump(one), bump(one), Object.keys(one).join());
console.log(deed(one), deed(one));
let log = "";
for (let turn = 0; turn < 300; turn++) {
    bump(one);
    if (turn % 100 === 99)
        log += one.n + " " + deed(one) + ";";
}
console.log(log);
console.log(bump(one), one.n, Counter.prototype.n, "n" in new Counter(2), Object.keys(new Counter(3)).join());
