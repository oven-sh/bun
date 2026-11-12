// A decorator in front of a class stands outside the strict code of the class: in sloppy code `yield` and `static` are names there.
var log = [];
function mark(label) { return function (value) { log.push(label + " " + typeof value); return value; }; }
var yield = mark, static = { mark };
var First = @yield("by a call") class {};
var Second = @static.mark("by a member") class {};
var Third = @(yield("in parentheses")) class {};
console.log(typeof First, typeof Second, typeof Third, log.join(", "));
