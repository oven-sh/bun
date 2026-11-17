function Few(a, b) { this.a = a; this.b = b; this.c = 1; }
function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o) + '|' + ('b' in o) + '|' + o.a + ',' + o.b + ',' + o.c; }
function make() { return new Few(undefined); }
console.log(show(make()), show(make()));
