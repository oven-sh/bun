// colors by a table of expressions, each with its own reader of the groups
'use strict';
var names = { red: 'f00', teal: '008080', navy: '000080', rebecca: '663399' };
var readers = [
  { re: /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i, read: function (m) { var c = []; for (var i = 1; i < 5; i++) c.push(m[i] === undefined ? 255 : parseInt(m[i] + m[i], 16)); c[3] /= 255; return c; } },
  { re: /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i, read: function (m) { var c = []; for (var i = 1; i < m.length; i++) c.push(m[i] === undefined ? 255 : parseInt(m[i], 16)); c[3] /= 255; return c; } },
  { re: /^rgba?\(\s*(\d+%?)\s*[, ]\s*(\d+%?)\s*[, ]\s*(\d+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i, read: function (m) { var c = [0, 0, 0, 1]; for (var i = m.length; i-- > 1;) { var p = m[i]; if (p === undefined) continue; var n = parseFloat(p); c[i - 1] = p[p.length - 1] === '%' ? i === 4 ? n / 100 : n * 2.55 : n; } return c; } },
  { re: /^hsla?\(\s*(-?[\d.]+)(deg|turn|rad)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%(?:\s*[,/]\s*([\d.]+))?\s*\)$/i, read: function (m) { var h = +m[1] * (m[2] === 'turn' ? 360 : m[2] === 'rad' ? 180 / Math.PI : 1); return hsl(((h % 360) + 360) % 360, m[3] / 100, m[4] / 100).concat(m[5] === undefined ? 1 : +m[5]); } }
];
function hsl(h, s, l) { var a = s * Math.min(l, 1 - l); return [0, 8, 4].map(function (n) { var k = (n + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); }); }
function Color(text) {
  var s = String(text).trim();
  if (Object.prototype.hasOwnProperty.call(names, s.toLowerCase())) s = '#' + names[s.toLowerCase()];
  for (var i = 0; i < readers.length; i++) {
    var m = s.match(readers[i].re);
    if (m) { this.kind = i; this.c = readers[i].read(m); this.groups = 0; for (var k = 1; k < m.length; k++) if (m[k] !== undefined) this.groups += m[k].length; return; }
  }
  throw new RangeError('unknown color: ' + text);
}
Color.prototype.hex = function () { return '#' + this.c.slice(0, 3).map(function (v) { v = Math.round(Math.max(0, Math.min(255, v))); return (v < 16 ? '0' : '') + v.toString(16); }).join('') + (this.c[3] < 1 ? Math.round(this.c[3] * 255).toString(16) : ''); };
Color.prototype.mix = function (o, w) { var r = Object.create(Color.prototype); r.kind = -1; r.c = this.c.map(function (v, i) { return v * (1 - w) + o.c[i] * w; }); return r; };
Object.defineProperty(Color.prototype, 'luminance', { get: function () { return this.c.slice(0, 3).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce(function (s, v, i) { return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0); } });
Color.readers = readers;
module.exports = Color;
