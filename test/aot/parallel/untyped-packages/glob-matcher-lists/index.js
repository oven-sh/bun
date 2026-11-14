// wildcards to expressions, braces, negation, a cache
'use strict';
var cache = {}, hits = 0;
function expand(p) {
  var m = /^(.*?)\{([^{}]*,[^{}]*)\}(.*)$/.exec(p);
  if (!m) return [p];
  var out = []; m[2].split(',').forEach(function (alt) { out.push.apply(out, expand(m[1] + alt + m[3])); });
  return out;
}
function toSource(p) {
  var re = '', i = 0, c;
  while (i < p.length) {
    c = p.charAt(i++);
    if (c === '*') { if (p.charAt(i) === '*') { i++; if (p.charAt(i) === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; } else re += '[^/]*'; }
    else if (c === '?') re += '[^/]';
    else if (c === '[') { var e = p.indexOf(']', i); if (e < 0) re += '\\['; else { var set = p.slice(i, e); if (set.charAt(0) === '!') set = '^' + set.slice(1); re += '[' + set.replace(/\\/g, '\\\\') + ']'; i = e + 1; } }
    else re += c.replace(/[.+^${}()|\\\/]/, '\\$&');
  }
  return re;
}
function make(pattern, flags) {
  var key = pattern + '\0' + (flags || ''); if (cache[key]) { hits++; return cache[key]; }
  var not = pattern.charAt(0) === '!', body = not ? pattern.slice(1) : pattern;
  var re = new RegExp('^(?:' + expand(body).map(toSource).join('|') + ')$', flags);
  var f = function (path) { return re.test(path) !== not; };
  f.re = re; return (cache[key] = f);
}
function filter(list, patterns) {
  return list.filter(function (x) { var yes = false; for (var i = 0; i < patterns.length; i++) { var p = patterns[i]; if (p.charAt(0) === '!') { if (make(p.slice(1))(x)) yes = false; } else if (make(p)(x)) yes = true; } return yes; });
}
module.exports = { make: make, filter: filter, expand: expand, hits: function () { return hits; } };
