function Few(a, b) { this.a = a; this.b = b; this.c = 1; }
function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o) + '|' + ('b' in o) + '|' + o.a + ',' + o.b + ',' + o.c; }
function make() { return new Few(1); }
const first = Object.freeze(make()); let threw = 0; try { 'use strict'; first.b = 3; } catch { threw++; }
console.log(show(first), show(make()), threw);
