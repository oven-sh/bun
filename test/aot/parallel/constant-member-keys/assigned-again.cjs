"use strict";
var KEY = "a", OTHER = "x";
let NAME = "n";
function read(o) { return o[KEY] + o[NAME]; }
const out = [read({ a: 1, b: 2, n: 10, m: 20 })];
KEY = "b";
out.push(read({ a: 1, b: 2, n: 10, m: 20 }));
NAME = "m";
out.push(read({ a: 1, b: 2, n: 10, m: 20 }));
var OTHER = "y";
out.push(OTHER, { x: 1, y: 2 }[OTHER]);
console.log(out.join());
