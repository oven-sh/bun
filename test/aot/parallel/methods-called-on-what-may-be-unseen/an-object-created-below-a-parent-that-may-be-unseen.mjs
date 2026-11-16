const unseen = new Function("return { m() { this.x = 'changed'; this.extra = 1; return 7; } }")();
const other = new Function("return { m() { return 1; } }")();
const inSight = { m() { return this.x + 100; } };
function make(flag, v) { const o = Object.create(flag ? inSight : unseen); o.x = v; return o; }
function call(r) { return r.m(); }
function read(o) { return o.x; }
const a = make(true, 5), b = make(false, 6);
const before = read(a) + read(b);
console.log(before, call(other), call(a), call(b), read(a), read(b), typeof read(b), Object.keys(a).join(), Object.keys(b).join());
