// a table of expressions tried in turn; the groups of the first that matches are copied by index, upward and downward
'use strict';
var rules = [
  { name: 'assign', re: /^(\w+)\s*(\+?=)\s*(.+)$/, keys: ['target', 'op', 'value'] },
  { name: 'call', re: /^(\w+(?:\.\w+)*)\((.*)\)$/, keys: ['callee', 'args'] },
  { name: 'for', re: /^for (\w+) in (\w+)(?: by (\d+))?(?: if (.+))?$/, keys: ['name', 'list', 'step', 'test'] },
  { name: 'date', re: /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d)(?:\.(\d+))?)?(Z|[+-]\d\d:?\d\d)?)?$/, keys: ['y', 'm', 'd', 'h', 'min', 's', 'ms', 'z'] },
  { name: 'range', re: /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/, keys: ['from', 'to'] },
  { name: 'word', re: /^(\w+)$/, keys: ['word'] }
];
function groups(m, keys) {
  var out = {};
  for (var i = 1; i < m.length; i++) {
    if (m[i] !== undefined) out[keys[i - 1]] = m[i];
  }
  return out;
}
function down(m) {
  var out = [];
  for (var i = m.length; i-- > 1;) out.push(m[i] === undefined ? '-' : m[i]);
  return out;
}
function match(text, list) {
  for (var r = 0; r < list.length; r++) {
    var m = list[r].re.exec(text);
    if (m) return { rule: list[r].name, groups: groups(m, list[r].keys), down: down(m), index: m.index, all: m[0] };
  }
  return null;
}
function longest(text, list) {
  var best = null;
  for (var r = 0; r < list.length; r++) {
    var m = text.match(list[r].re);
    if (m !== null && (!best || String(m[1]).length > String(best[1]).length)) best = m;
  }
  if (!best) return '';
  var n = 0;
  for (var i = 1; i < best.length; i++) n += (best[i] || '').length;
  return best[1] + '/' + n + '/' + best.length;
}
function Reader(list) { this.rules = list || rules; this.count = {}; }
Reader.prototype.read = function (lines) {
  var self = this, out = [];
  lines.forEach(function (l) {
    var m = match(l, self.rules);
    if (m) { self.count[m.rule] = (self.count[m.rule] || 0) + 1; out.push(m); }
    else out.push({ rule: 'none', groups: {}, down: [l] });
  });
  return out;
};
module.exports = { Reader: Reader, match: match, longest: longest, rules: rules };
