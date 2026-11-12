// memoize with resolvers, limits and weak keys; once, curry, compose, partial, after, before, pipeline with placeholders
var slice = Array.prototype.slice;
function memoize(fn, options) {
  var o = options || {}, resolver = o.resolver || function () { return arguments.length < 2 ? arguments[0] : slice.call(arguments).map(function (a) { return typeof a + ':' + String(a); }).join('|'); };
  function memoized() {
    var key = resolver.apply(this, arguments), cache = memoized.cache;
    if (o.weak && key !== null && typeof key === 'object') cache = memoized.weak;
    if (cache.has(key)) { memoized.hits++; var v = cache.get(key); if (o.max && cache === memoized.cache) { cache.delete(key); cache.set(key, v); } return v; }
    memoized.misses++;
    var value = fn.apply(this, arguments);
    if (o.max && cache === memoized.cache && cache.size >= o.max) { var first = cache.keys().next().value; cache.delete(first); if (o.evict) o.evict(first); }
    cache.set(key, value);
    if (value && typeof value.then === 'function') value.then(null, function () { cache.delete(key); });
    return value;
  }
  memoized.cache = new Map(); memoized.weak = new WeakMap(); memoized.hits = memoized.misses = 0;
  Object.defineProperty(memoized, 'length', { value: fn.length }); Object.defineProperty(memoized, 'name', { value: 'memoized ' + fn.name });
  return memoized;
}
function curry(fn, arity) { arity = arity === undefined ? fn.length : arity; return (function more(args) { return function () { var all = args.map(function (x) { return x; }), given = slice.call(arguments); for (var i = 0; i < all.length && given.length; i++) if (all[i] === curry._) all[i] = given.shift(); all = all.concat(given); var full = all.length >= arity; for (var k = 0; k < arity; k++) if (all[k] === curry._) full = false; return full ? fn.apply(this, all) : more(all); }; }([])); }
curry._ = { toString: function () { return '_'; } };
function compose() { var fns = arguments, n = fns.length; return function () { var i = n - 1, r = fns[i].apply(this, arguments); while (i--) r = fns[i].call(this, r); return r; }; }
function once(fn) { var called = false, v; return function () { if (called) return v; called = true; v = fn.apply(this, arguments); fn = null; return v; }; }
function after(n, fn) { return function () { if (--n < 1) return fn.apply(this, arguments); }; }
function before(n, fn) { var r; return function () { if (--n > 0) r = fn.apply(this, arguments); if (n <= 1) fn = undefined; return r; }; }
function partial(fn) { var bound = slice.call(arguments, 1); return function () { var at = 0, args = bound.map(function (b) { return b === curry._ ? null : b; }); for (var i = 0; i < bound.length; i++) if (bound[i] === curry._) args[i] = arguments[at++]; while (at < arguments.length) args.push(arguments[at++]); if (this instanceof arguments.callee) { var self = Object.create(fn.prototype), res = fn.apply(self, args); return Object(res) === res ? res : self; } return fn.apply(this, args); }; }
module.exports = { memoize: memoize, curry: curry, compose: compose, once: once, after: after, before: before, partial: partial, _: curry._ };
