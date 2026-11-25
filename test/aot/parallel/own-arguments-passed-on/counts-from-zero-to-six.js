var call = (0, eval)("(f, t, list) => { switch (list.length) { case 0: return f.call(t); case 1: return f.call(t, list[0]); case 2: return f.call(t, list[0], list[1]); default: return f.apply(t, list); } }");
function target() { var s = typeof this + ":" + arguments.length; for (var i = 0; i < arguments.length; i++) s += "," + String(arguments[i]); return s; }
var holder = { target: target };
function none() { return holder.target.apply(this, arguments); }
function one(a) { return holder.target.apply(this, arguments); }
function two(a, b) { return holder.target.apply(this, arguments); }
function four(a, b, c, d) { return holder.target.apply(this, arguments); }
function five(a, b, c, d, e) { return holder.target.apply(this, arguments); }
function notLast(a) { var r = holder.target.apply(this, arguments); return "[" + r + "]" + a; }
function byReflect(a) { return Reflect.apply(holder.target, this, arguments); }
var wrappers = [none, one, two, four, five, notLast, byReflect], all = [1, undefined, "c", null, 5, 6];
for (var round = 0; round < 3; round++)
  for (var w = 0; w < wrappers.length; w++)
    for (var n = 0; n <= 6; n++) console.log(w, n, call(wrappers[w], n & 1 ? "text" : { o: 1 }, all.slice(0, n)));
