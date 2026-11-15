function Few(a, b) { this.a = a; this.b = b; this.c = 1; }
function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o) + '|' + ('b' in o) + '|' + o.a + ',' + o.b + ',' + o.c; }
let seen = '';
Object.defineProperty(Few.prototype, 'b', { set(v) { seen += Object.keys(this).join() + ':' + v + ';'; }, get() { return 7; }, configurable: true });
function make() { return new Few(1); }
console.log(show(make()), show(make()), seen);
