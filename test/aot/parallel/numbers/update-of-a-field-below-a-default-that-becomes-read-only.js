// `c.n++` below `Counter.prototype.n = 0`: the prototype is frozen later. An object with an n of its own goes on counting, and the first update of any other object is refused
function Counter(id) { this.id = id; }
Counter.prototype.n = 0;
function bump(c) { c.n++; return c.n; }
function deed(c) { try { return String(bump(c)); } catch (error) { return error.name; } }
const old = new Counter(1);
console.log(deed(old), deed(old), deed(new Counter(2)));
Object.freeze(Counter.prototype);
const late = new Counter(3);
console.log(deed(old), deed(late), late.n, Object.keys(late).join());
let log = "";
for (let turn = 0; turn < 300; turn++)
    log = deed(old) + " " + deed(late) + " " + deed(new Counter(turn));
console.log(log, Counter.prototype.n, Object.keys(old).join(), Object.keys(late).join());
