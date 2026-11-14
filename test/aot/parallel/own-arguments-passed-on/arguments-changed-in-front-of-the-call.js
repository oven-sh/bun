var call = (0, eval)("(f, list) => f.apply(null, list)");
function target() { var s = "" + arguments.length; for (var i = 0; i < arguments.length; i++) s += "," + String(arguments[i]); return s; }
var holder = { target: target };
function parameterStored(a, b) { a = "stored"; return holder.target.apply(this, arguments); }
function parameterStoredStrict(a, b) { "use strict"; a = "stored"; return holder.target.apply(this, arguments); }
function elementStored(a, b) { arguments[1] = "element"; return holder.target.apply(this, arguments) + ":" + b; }
function elementBehindStored(a) { arguments[2] = "behind"; return holder.target.apply(this, arguments); }
function lengthStored(a, b) { arguments.length = 1; return holder.target.apply(this, arguments); }
function lengthGrown(a) { arguments.length = 3; return holder.target.apply(this, arguments); }
function elementDeleted(a, b) { delete arguments[0]; return holder.target.apply(this, arguments); }
function readFirst(a, b) { var n = arguments.length + String(arguments[1]); return n + "|" + holder.target.apply(this, arguments); }
var wrappers = [parameterStored, parameterStoredStrict, elementStored, elementBehindStored, lengthStored, lengthGrown, elementDeleted, readFirst];
for (var round = 0; round < 3; round++)
  for (var w = 0; w < wrappers.length; w++)
    for (var n = 0; n <= 4; n++) console.log(w, n, call(wrappers[w], [1, 2, 3, 4].slice(0, n)));
