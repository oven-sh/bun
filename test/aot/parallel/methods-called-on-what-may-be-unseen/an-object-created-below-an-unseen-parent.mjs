const parent = new Function("return { m() { this.x = 'changed'; this.extra = 1; return 7; } }")();
const other = new Function("return { m() { return 1; } }")();
function make(v) { const o = Object.create(parent); o.x = v; return o; }
function call(r) { return r.m(); }
function read(o) { return o.x; }
const o = make(5), p = make(6);
const before = read(o) + read(p);
console.log(before, call(other), call(o), read(o), typeof read(o), read(p), Object.keys(o).join(), call(p), read(p));
