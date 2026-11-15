function read(o) { return KEY === undefined ? "early" : o[KEY]; }
var first = eval("read({ a: 1 })"), second;
{ let KEY = 1; eval("second = read({ a: KEY })"); }
{ let KEY = 1, OTHER = 2; eval("'use strict'; first += readOther()"); }
function readOther() { return OTHER === undefined ? " early" : OTHER; }
var KEY = "a", OTHER = "b";
console.log(first, second, read({ a: 1 }), readOther());
