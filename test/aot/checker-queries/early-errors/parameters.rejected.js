// A rest parameter that is not last or has a default, and a line break before =>.
function f(...a, b) {}
function f(...a = []) {}
function f(...a,) {}
(...a, b) => 1;
(a)⏎=> 1;
