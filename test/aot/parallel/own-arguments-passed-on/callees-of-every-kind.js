var call = (0, eval)("(f, list) => { try { return f.apply({ me: 1 }, list); } catch (e) { return e.constructor.name; } }");
var holder = { target: null };
function wrap(a) { return holder.target.apply(this, arguments); }
function keepsList() { kept.push(arguments); return arguments.length; }
function rest(...values) { kept.push(values); values.push("mine"); return values.join(); }
function storesInto(a, b) { arguments[0] = "changed"; a = "again"; return a + arguments.length; }
class Klass { constructor() { this.x = 1; } }
var kept = [], own = function () { return "never"; }; own.apply = function (t, list) { return "own apply:" + list.length; };
var targets = [keepsList, rest, storesInto, Math.max, function () { return this.me; }.bind({ me: "bound" }), new Proxy(rest, {}), Klass, own, (a, b) => String(a) + b, undefined, null, 5, {}, "text"];
for (var round = 0; round < 3; round++)
  for (var t = 0; t < targets.length; t++) {
    holder.target = targets[t];
    for (var n = 0; n <= 3; n++) console.log(t, n, String(call(wrap, [4, 7, 2].slice(0, n))));
  }
console.log(kept.length, kept.map(k => Array.prototype.join.call(k)).join("|"));
