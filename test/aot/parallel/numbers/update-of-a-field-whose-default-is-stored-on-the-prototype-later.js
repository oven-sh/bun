// `c.n++` below `Counter.prototype.n = 0`: another number, and then a text, is stored on the prototype later. An object with an n of its own keeps it, any other starts from what lies above now
function Counter(id) { this.id = id; }
Counter.prototype.n = 0;
function bump(c) { c.n++; return c.n; }
function deed(value) { Counter.prototype.n = value; }
const old = new Counter(1);
const late = new Counter(2);
console.log(bump(old), bump(old), late.n);
deed(50);
console.log(bump(old), late.n, bump(late), bump(late), new Counter(3).n);
for (let turn = 0; turn < 300; turn++) {
    deed(turn);
    bump(old);
}
console.log(old.n, late.n, bump(new Counter(4)), Counter.prototype.n);
deed("7");
console.log(bump(new Counter(5)), bump(old), typeof new Counter(6).n, Object.keys(old).join(), Object.keys(new Counter(7)).join());
