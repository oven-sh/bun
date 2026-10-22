// Repeated names that are errors in sloppy mode code too.
function f(a, a) { "use strict"; }
(a, a) => 1;
function f(a, a = 1) {}
let a; var a;
