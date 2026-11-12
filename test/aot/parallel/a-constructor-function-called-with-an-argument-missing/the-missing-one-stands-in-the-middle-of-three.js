function Few(a, b, c) { this.a = a; this.c = c; this.b = b; this.d = 2; }
function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o); }
function make() { return new Few(1, 2); }
console.log(show(make()), show(make()));
