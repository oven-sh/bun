// A variable begins as a number and is later given one literal, as a table of states is. The labels of a switch in a loop read names off it: it holds the literal by then.
// Under: --aot-check=Validate: the read tests the cell itself, and the compiler's own checks look at both ways.
'use strict';
var S = 0, turns = JSON.parse("4");
function fill() { S = { BEGIN: 1, TEXT: 2, END: 3 }; }
function told(state) { var n = 0; for (var i = 0; i < turns; i++) { switch (state) { case S.BEGIN: n += 1; break; case S.TEXT: n += 20; break; case S.END: n += 300; break; default: n += 4000; } } return n; }
fill(); console.log(told(1), told(2), told(3), told(9), told(undefined));
