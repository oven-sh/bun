function f() { return (f.caller && f.caller.name) + " | " + (f.arguments && f.arguments.length); }
function reads() { return f(1, 2); }
function stores() { f.caller = 1; f.arguments = 2; return "ignored"; }
module.exports = { reads, stores };
