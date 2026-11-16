// iterators without generators: next, return, chained and lazy
'use strict';
function Range(a, b, step) { this.a = a; this.b = b; this.step = step || 1; }
Range.prototype[Symbol.iterator] = function () { var self = this, x = this.a, done = false; return { next: function () { if (done || (self.step > 0 ? x >= self.b : x <= self.b)) { done = true; return { value: undefined, done: true }; } var v = x; x += self.step; return { value: v, done: false }; }, return: function (v) { done = true; Range.closed++; return { value: v, done: true }; }, [Symbol.iterator]: function () { return this; } }; };
Range.closed = 0;
function Lazy(source) { this.source = source; this.ops = []; }
Lazy.of = function (s) { return new Lazy(s); };
['map', 'filter', 'take', 'drop', 'flat', 'chunk', 'while'].forEach(function (op) { Lazy.prototype[op] = function (f) { var l = new Lazy(this.source); l.ops = this.ops.concat({ op: op, f: f }); return l; }; });
Lazy.prototype[Symbol.iterator] = function () {
  var it = this.source[Symbol.iterator](), state = this.ops.map(function (o) { return o.op === 'chunk' ? [] : 0; }), ops = this.ops, queue = [], ended = false;
  function feed(v, i) {
    for (; i < ops.length; i++) { var o = ops[i]; switch (o.op) {
      case 'map': v = o.f(v); break; case 'filter': if (!o.f(v)) return true; break; case 'take': if (state[i] >= o.f) return false; state[i]++; if (state[i] === o.f) { var more = feed(v, i + 1); return more && false; } break;
      case 'drop': if (state[i]++ < o.f) return true; break; case 'while': if (!o.f(v)) return false; break; case 'chunk': state[i].push(v); if (state[i].length < o.f) return true; v = state[i]; state[i] = []; break;
      case 'flat': for (var k = 0, l = Array.from(v); k < l.length; k++) if (!feed(l[k], i + 1)) return false; return true; } }
    queue.push(v); return true;
  }
  return { next: function () { while (!queue.length && !ended) { var r = it.next(); if (r.done) { ended = true; for (var i = 0; i < ops.length; i++) if (ops[i].op === 'chunk' && state[i].length) { var rest = state[i]; state[i] = []; feed(rest, i + 1); } } else if (!feed(r.value, 0)) { ended = true; if (it.return) it.return(); } } return queue.length ? { value: queue.shift(), done: false } : { value: undefined, done: true }; }, return: function (v) { ended = true; queue.length = 0; if (it.return) it.return(); return { value: v, done: true }; } };
};
Lazy.prototype.toArray = function () { var out = []; for (var x of this) out.push(x); return out; };
module.exports = { Range: Range, Lazy: Lazy };
