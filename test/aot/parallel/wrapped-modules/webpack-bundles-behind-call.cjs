// Bundles in functions that are entered by call(), apply() or under other names.
const out = [];
const tell = (f) => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
const keep = [];
(function () {
  var e = { 1: function (e, t) { t.self = typeof this; t.count = (globalThis.entered = (globalThis.entered || 0) + 1); }, 2: (e, t, n) => { t.one = n(1); t.same = n(1) === n(1); } }, t = {};
  function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r].call(i.exports, i, i.exports, n), i.exports }
  keep.push(n(2));
}).call(this);
tell(() => JSON.stringify(keep));
const twice = function () {
  var e = { 1: (e, t) => { t.value = {}; } }, t = {};
  function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports }
  return n(1).value;
};
tell(() => twice.call(1) === twice.call(2));
const answer = (function (a) {
  var e = { 1: (e, t) => { t.value = a; } }, t = {};
  function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports }
  return n(1).value;
}).call(null, 7);
tell(() => answer);
for (let i = 0; i < 2; i++) (function () {
  var e = { 1: (e, t) => { t.value = {}; } }, t = {};
  function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports }
  keep.push(n(1).value);
}).call(this);
tell(() => keep.length + " " + (keep[1] === keep[2]));
(function () {
  var e = { 1: (e, t) => { t.value = {}; } }, t = {};
  function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports }
  keep.push(n(1).value);
}).apply(this);
(function () {
  var e = { 1: (e, t) => { t.value = this === globalThis; } }, t = {};
  function n(r) { var o = t[r]; if (void 0 !== o) return o.exports; var i = t[r] = { exports: {} }; return e[r](i, i.exports, n), i.exports }
  keep.push(n(1).value);
}).call(globalThis);
tell(() => keep.length + " " + keep[4]);
console.log(out.join("\n"));
