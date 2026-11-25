function Few(a, b) { this.a = a; this.b = b; this.c = 1; }
function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o) + '|' + ('b' in o) + '|' + o.a + ',' + o.b + ',' + o.c; }
function whole(i) { return new Few(i, i + 0.5); }
function part(i) { return new Few(i); }
let out = ''; for (let i = 0; i < 3; i++) out += show(whole(i)) + show(part(i)) + ';'; console.log(out);
