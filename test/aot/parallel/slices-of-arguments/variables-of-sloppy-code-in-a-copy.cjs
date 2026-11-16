// In sloppy code an element of `arguments` is the variable of its parameter: what is assigned to the one is read off the other.
var slice = Array.prototype.slice;
function first(a, b) { a = 50; var args = slice.call(arguments); return args[0] + args.length; }
function second(a, b) { arguments[1] = 60; var args = slice.call(arguments); return args[1] + b; }
function third(a, b) { b = 70; var args = slice.call(arguments); return args.length; }
function run(n) { var total = 0; for (var i = 0; i < n; i++) total += first(i, 1) + second(i, 1) + third(i); return total; }
console.log(run(100), first(1, 2), second(1, 2), third(1));
