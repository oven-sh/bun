// `c.n++` below `Counter.prototype.n = 0`: the object's own n holds an object whose valueOf deletes the property between the read and the store. The store creates it anew, behind the other keys
function Counter(id) { this.id = id; this.last = 0; }
Counter.prototype.n = 0;
function bump(c) { c.n++; return c.n; }
let log = "";
function deed(c) { c.n = { valueOf() { log += "v"; delete c.n; c.late = 1; return 41; } }; return bump(c) + " " + Object.keys(c).join(); }
const one = new Counter(1);
console.log(bump(one), bump(one), Object.keys(one).join());
console.log(deed(one), log);
for (let turn = 0; turn < 300; turn++)
    bump(one);
console.log(one.n, deed(one), bump(one), log);
