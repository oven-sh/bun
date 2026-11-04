// the callee IS Function.prototype.apply's: the arm where the guess holds
const unseen = (0, eval)("(x) => x");
const sink = unseen(function () { return arguments.length + ":" + Array.prototype.join.call(arguments, ","); });
function wrap(first, ...others) { others.push("added"); return sink.apply(null, arguments); }
function wrap2(first, ...others) { others.length = 0; return sink.apply(null, arguments); }
let last = "";
for (let i = 0; i < 300; i++) last = wrap("a", "b", "c") + " " + wrap2("a", "b", "c");
console.log(last);
