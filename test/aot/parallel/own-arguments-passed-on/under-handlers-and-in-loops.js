var call = (0, eval)("(f, list) => f.apply(null, list)");
function target() { if (arguments[0] === "throw") throw new RangeError("thrown:" + arguments.length); return arguments.length; }
var holder = { target: target };
function catches(a) { try { return holder.target.apply(this, arguments); } catch (e) { return e.message; } }
function finishes(a) { var s = "-"; try { s = holder.target.apply(this, arguments); } catch (e) { s = e.message; } finally { s += "!"; } return s; }
function inLoop(a) { var s = 0; for (var i = 0; i < 3; i++) s += holder.target.apply(this, arguments); return s; }
function twice(a) { return holder.target.apply(this, arguments) + ":" + holder.target.apply(this, arguments); }
function onOneWay(a, b) { if (a === 1) return "early"; return holder.target.apply(this, arguments); }
function inClosure(a) { var all = arguments, self = this; return (function () { return holder.target.apply(self, all); })(); }
var wrappers = [catches, finishes, inLoop, twice, onOneWay, inClosure];
for (var round = 0; round < 3; round++)
  for (var w = 0; w < wrappers.length; w++)
    for (var n = 0; n <= 3; n++) { var list = [w < 2 && n === 2 ? "throw" : 1, 2, 3].slice(0, n); console.log(w, n, String(call(wrappers[w], list))); }
