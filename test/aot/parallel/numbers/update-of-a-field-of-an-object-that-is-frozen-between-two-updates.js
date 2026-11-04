// `c.n++` below `Counter.prototype.n = 0`: the object is frozen between two updates, with an n of its own and without one. The slot stays as it is and the store is refused
function Counter(id) { this.id = id; }
Counter.prototype.n = 0;
function bump(c) { c.n++; return c.n; }
function deed(c) { try { return String(bump(c)); } catch (error) { return error.name; } }
const one = new Counter(1);
console.log(deed(one), deed(one));
for (let turn = 0; turn < 300; turn++)
    deed(one);
console.log(one.n);
Object.freeze(one);
console.log(deed(one), one.n, deed(one), one.n, Object.isFrozen(one));
const cold = Object.freeze(new Counter(2));
console.log(deed(cold), cold.n, Object.keys(cold).join());
const sealed = Object.seal(new Counter(3));
console.log(deed(sealed), sealed.n, Object.keys(sealed).join());
const kept = new Counter(4);
console.log(deed(kept), deed(Object.seal(kept)), deed(Object.preventExtensions(kept)), kept.n);
