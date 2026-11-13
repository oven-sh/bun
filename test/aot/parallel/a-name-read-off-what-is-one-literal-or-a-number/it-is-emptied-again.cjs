// A variable begins as a number, is given one literal, and is emptied again: a name read off undefined throws what `bun <file>` throws, and off null too.
// Under: --aot-check=Validate: the read tests the cell itself, and the compiler's own checks look at both ways.
'use strict';
var S = 0, turns = JSON.parse("4");
function fill() { S = { BEGIN: 1, TEXT: 2, END: 3 }; }
function told(state) { var n = 0; for (var i = 0; i < turns; i++) { switch (state) { case S.BEGIN: n += 1; break; case S.TEXT: n += 20; break; case S.END: n += 300; break; default: n += 4000; } } return n; }
function empty(to) { S = to; }
fill(); console.log(told(2));
for (const to of [undefined, null, 7, "text", true]) { empty(to); try { console.log(String(to), told(undefined)); } catch (error) { console.log(String(to), error.name, error.message); } }
fill(); console.log(told(3));
