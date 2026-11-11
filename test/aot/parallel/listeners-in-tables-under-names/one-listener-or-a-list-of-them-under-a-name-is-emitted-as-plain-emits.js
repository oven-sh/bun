// Under a name lies one record, or a list of records once a second listener comes. Both shapes are emitted in hot loops, a name goes from the one to the other between them,
// and what is neither is laid there out of sight: a record without the field, a list of what is no record, a number.
function Kept(fn, context) { this.fn = fn; this.context = context; }
function Emitter() { this.events = {}; }
Emitter.prototype.on = function (name, fn) { var kept = new Kept(fn, this); if (!this.events[name]) this.events[name] = kept; else if (!this.events[name].fn) this.events[name].push(kept); else this.events[name] = [this.events[name], kept]; return this; };
Emitter.prototype.emit = function (name, a) { var l = this.events[name]; if (!l) return false; if (l.fn) return l.fn.call(l.context, a), true; for (var i = 0; i < l.length; i++) l[i].fn.call(l[i].context, a); return true; };
var e = new Emitter(), total = 0;
var attempt = function (f) { try { return String(f()); } catch (x) { return x.name; } };
e.on("one", function (n) { total += n; }); e.on("two", function (n) { total += n; }); e.on("two", function (n) { total -= n >> 1; });
function turn(t) { total = t & 7; for (var i = 0; i < 300; i++) { e.emit("one", i); e.emit("two", i); } return total; }
console.log(turn(1), turn(2), e.emit("none", 1));
e.on("one", function (n) { total += 2 * n; });
console.log(turn(3));
e.on("one", function (n) { total ^= n; });
console.log(turn(4));
var names = JSON.parse('["bare","numbers","seven","one"]');
e.events[names[0]] = { other: 1 }; e.events[names[1]] = [1, 2]; e.events[names[2]] = 7;
for (var k = 0; k < names.length; k++) console.log(names[k], attempt(function () { return e.emit(names[k], 5); }), total);
