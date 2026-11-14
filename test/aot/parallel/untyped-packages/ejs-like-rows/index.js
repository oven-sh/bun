// a template becomes the source of a function; here the function is built from closures, not from text
'use strict';
function tokenize(text) { var re = /<%([=_#-]?)([\s\S]*?)(-?)%>/g, out = [], last = 0, m; while ((m = re.exec(text)) !== null) { if (m.index > last) out.push({ k: 'text', v: text.slice(last, m.index) }); out.push({ k: m[1] === '=' ? 'esc' : m[1] === '-' ? 'raw' : m[1] === '#' ? 'note' : 'code', v: m[2].trim() }); last = re.lastIndex; if (m[3] === '-' && text[last] === '\n') { last++; re.lastIndex = last; } } if (last < text.length) out.push({ k: 'text', v: text.slice(last) }); return out; }
function expr(src) {
  var parts = src.split('|').map(function (s) { return s.trim(); }), path = parts.shift();
  var get = /^(['"]).*\1$/.test(path) ? function () { return path.slice(1, -1); } : /^-?\d/.test(path) ? function () { return Number(path); } : function (s) { var v = s, names = path.split('.'); for (var i = 0; i < names.length && v != null; i++) v = v[names[i]]; return v; };
  return function (scope) { var v = get(scope); parts.forEach(function (p) { var a = /^(\w+)(?:\((.*)\))?$/.exec(p); v = filters[a[1]].apply(null, [v].concat(a[2] ? a[2].split(',').map(Number) : [])); }); return v; };
}
var filters = { upper: function (s) { return String(s).toUpperCase(); }, pad: function (s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }, fixed: function (n, d) { return Number(n).toFixed(d); }, size: function (v) { return v == null ? 0 : v.length === undefined ? Object.keys(v).length : v.length; } };
function build(tokens, i, stop) {
  var body = [];
  for (; i < tokens.length; i++) {
    var t = tokens[i], m;
    if (t.k === 'text') body.push(function (v) { return function (s, o) { o.push(v); }; }(t.v));
    else if (t.k === 'esc' || t.k === 'raw') body.push(function (e, esc) { return function (s, o) { var v = e(s); if (v != null) o.push(esc ? String(v).replace(/</g, '&lt;') : v); }; }(expr(t.v), t.k === 'esc'));
    else if (t.k === 'code') {
      if ((m = /^each (\w+) in (.+)$/.exec(t.v))) { var sub = build(tokens, i + 1, 'end'); i = sub.i; body.push(function (name, e, b) { return function (s, o) { var list = e(s) || [], n = 0; for (var k in list) { var c = Object.create(s); c[name] = list[k]; c.key = k; c.index = n++; run(b, c, o); } }; }(m[1], expr(m[2]), sub.body)); }
      else if ((m = /^if (!?)(.+)$/.exec(t.v))) { var yes = build(tokens, i + 1, 'end'), no = { body: [] }; i = yes.i; if (yes.by === 'else') { no = build(tokens, i + 1, 'end'); i = no.i; } body.push(function (neg, e, y, n) { return function (s, o) { run(!!e(s) !== neg ? y : n, s, o); }; }(m[1] === '!', expr(m[2]), yes.body, no.body)); }
      else if (t.v === 'else' || t.v === stop) return { body: body, i: i, by: t.v }; else throw new Error('unknown tag ' + t.v);
    }
  }
  if (stop) throw new Error('missing ' + stop); return { body: body, i: i };
}
function run(body, scope, out) { for (var i = 0; i < body.length; i++) body[i](scope, out); return out; }
exports.compile = function (text) { var b = build(tokenize(text), 0).body; return function (data) { return run(b, data, []).join(''); }; };
