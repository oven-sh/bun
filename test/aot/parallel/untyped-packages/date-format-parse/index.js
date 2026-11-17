// formats and parses dates by tokens; everything in UTC
'use strict';
var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var token = /\[([^\]]+)]|YYYY|YY|M{1,4}|Do|D{1,2}|d{3,4}|H{1,2}|h{1,2}|m{1,2}|s{1,2}|SSS|A|a|X|Q|W/g;
function pad(v, n) { v = String(v); while (v.length < (n || 2)) v = '0' + v; return v; }
function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function week(d) { var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); }
var flags = {
  YYYY: function (d) { return pad(d.getUTCFullYear(), 4); }, YY: function (d) { return String(d.getUTCFullYear()).slice(-2); },
  M: function (d) { return d.getUTCMonth() + 1; }, MM: function (d) { return pad(d.getUTCMonth() + 1); }, MMM: function (d) { return MONTHS[d.getUTCMonth()].slice(0, 3); }, MMMM: function (d) { return MONTHS[d.getUTCMonth()]; },
  D: function (d) { return d.getUTCDate(); }, DD: function (d) { return pad(d.getUTCDate()); }, Do: function (d) { return ordinal(d.getUTCDate()); },
  ddd: function (d) { return DAYS[d.getUTCDay()].slice(0, 3); }, dddd: function (d) { return DAYS[d.getUTCDay()]; },
  H: function (d) { return d.getUTCHours(); }, HH: function (d) { return pad(d.getUTCHours()); }, h: function (d) { return d.getUTCHours() % 12 || 12; }, hh: function (d) { return pad(d.getUTCHours() % 12 || 12); },
  m: function (d) { return d.getUTCMinutes(); }, mm: function (d) { return pad(d.getUTCMinutes()); }, s: function (d) { return d.getUTCSeconds(); }, ss: function (d) { return pad(d.getUTCSeconds()); }, SSS: function (d) { return pad(d.getUTCMilliseconds(), 3); },
  A: function (d) { return d.getUTCHours() < 12 ? 'AM' : 'PM'; }, a: function (d) { return d.getUTCHours() < 12 ? 'am' : 'pm'; }, X: function (d) { return Math.floor(d / 1000); }, Q: function (d) { return (d.getUTCMonth() / 3 | 0) + 1; }, W: week
};
function format(date, mask) { var d = new Date(date); if (isNaN(d)) throw new TypeError('Invalid date'); return mask.replace(token, function (m, lit) { return lit !== undefined ? lit : m in flags ? flags[m](d) : m; }); }
var parsers = {
  YYYY: ['(\\d{4})', function (o, v) { o.y = +v; }], MM: ['(\\d\\d)', function (o, v) { o.m = v - 1; }],
  MMM: ['([A-Za-z]{3})', function (o, v) { o.m = MONTHS.findIndex(function (x) { return x.slice(0, 3).toLowerCase() === v.toLowerCase(); }); }],
  DD: ['(\\d\\d)', function (o, v) { o.d = +v; }], D: ['(\\d\\d?)', function (o, v) { o.d = +v; }], HH: ['(\\d\\d)', function (o, v) { o.h = +v; }], mm: ['(\\d\\d)', function (o, v) { o.i = +v; }], ss: ['(\\d\\d)', function (o, v) { o.s = +v; }], A: ['(AM|PM)', function (o, v) { o.pm = v === 'PM'; }]
};
function parse(text, mask) {
  var acts = [], src = mask.replace(token, function (m) { if (!parsers[m]) throw new Error('no parser for ' + m); acts.push(parsers[m][1]); return parsers[m][0]; }), m = new RegExp('^' + src + '$', 'i').exec(text);
  if (!m) return null;
  var o = { y: 1970, m: 0, d: 1, h: 0, i: 0, s: 0 };
  for (var k = 1; k < m.length; k++) acts[k - 1](o, m[k]);
  if (o.pm !== undefined) o.h = o.h % 12 + (o.pm ? 12 : 0);
  var t = new Date(Date.UTC(o.y, o.m, o.d, o.h, o.i, o.s));
  return t.getUTCMonth() === o.m && t.getUTCDate() === o.d ? t : null;
}
function add(date, n, unit) {
  var d = new Date(date);
  if (unit === 'month' || unit === 'year') { var day = d.getUTCDate(); d.setUTCDate(1); if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + n); else d.setUTCFullYear(d.getUTCFullYear() + n); d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate())); return d; }
  return new Date(+d + n * { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5 }[unit]);
}
function relative(a, b) {
  var s = Math.round((b - a) / 1000), units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
  for (var i = 0; i < units.length; i++) { var n = Math.trunc(s / units[i][1]); if (n) return (n > 0 ? 'in ' : '') + Math.abs(n) + ' ' + units[i][0] + (Math.abs(n) > 1 ? 's' : '') + (n < 0 ? ' ago' : ''); }
  return 'now';
}
module.exports = { format: format, parse: parse, add: add, relative: relative };
