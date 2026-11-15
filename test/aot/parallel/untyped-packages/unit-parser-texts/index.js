// amounts with units read by one table after the other: durations, sizes, angles, money, coordinates, times of day
var UNITS = [
  { kind: 'time', re: /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i, by: { ms: 1, s: 1000, m: 6e4, h: 36e5, d: 864e5, w: 6048e5, y: 315576e5 } },
  { kind: 'size', re: /^((-|\+)?(\d+(?:\.\d+)?)) *(kb|mb|gb|tb|b)$/i, by: { b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 } },
  { kind: 'angle', re: /^(-?[\d.]+)(deg|rad|turn|°)(?: ?(\d+)['′])?(?: ?([\d.]+)["″])?$/ },
  { kind: 'money', re: /^([$€£])\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d\d))?$|^(\d+)(?:\.(\d\d))? (USD|EUR|GBP)$/ },
  { kind: 'clock', re: /^(\d\d?):(\d\d)(?::(\d\d)(?:\.(\d{1,3}))?)?(?: ?([ap])m?)?$/i }
];
function unit(u) { u = (u || 'ms').toLowerCase(); if (/^(ms|msec|milli)/.test(u)) return 'ms'; if (/^mi?n?/.test(u) && u !== 'mb') return 'm'; return u.charAt(0) === 'h' ? 'h' : u.charAt(0); }
function parse(text) {
  var t = String(text), m, i, part;
  for (var u = 0; u < UNITS.length; u++) {
    m = UNITS[u].re.exec(t);
    if (!m) continue;
    switch (UNITS[u].kind) {
      case 'time': return { kind: 'time', value: parseFloat(m[1]) * UNITS[u].by[unit(m[2])], unit: unit(m[2]) };
      case 'size': return { kind: 'size', value: Math.floor(UNITS[u].by[m[4].toLowerCase()] * m[1]), sign: m[2] };
      case 'angle': var v = +m[1], k = 60; for (i = 3; i < m.length; i++, k *= 60) if ((part = m[i]) !== undefined) v += part / k; return { kind: 'angle', value: m[2] === 'rad' ? v * 180 / Math.PI : m[2] === 'turn' ? v * 360 : v, parts: m.length };
      case 'money': var found = []; for (i = 1; i < m.length; i++) if (m[i] !== undefined) found.push(m[i].replace(/,/g, '')); return { kind: 'money', value: found.filter(function (f) { return /^\d+$/.test(f); }).reduce(function (s, f, n) { return s + (n ? f / 100 : +f); }, 0), mark: m[1] || m[6], n: found.length };
      case 'clock': var sum = 0, scale = 36e5; for (i = 1; i <= 3; i++, scale /= 60) sum += (m[i] || 0) * scale; if (m[4]) sum += +(m[4] + '00').slice(0, 3); if (m[5]) { var h = +m[1]; if (h > 12 || h === 0) return { kind: 'clock', value: NaN }; sum += (m[5].toLowerCase() === 'p' ? h === 12 ? 0 : 12 : h === 12 ? -12 : 0) * 36e5; } return { kind: 'clock', value: sum };
    }
  }
  return { kind: 'none', value: t.length };
}
function print(o, long) { switch (o.kind) { case 'time': var a = Math.abs(o.value), list = [['d', 864e5, 'day'], ['h', 36e5, 'hour'], ['m', 6e4, 'minute'], ['s', 1000, 'second']]; for (var i = 0; i < list.length; i++) if (a >= list[i][1]) { var n = Math.round(o.value / list[i][1]); return long ? n + ' ' + list[i][2] + (a >= list[i][1] * 1.5 ? 's' : '') : n + list[i][0]; } return o.value + (long ? ' ms' : 'ms'); case 'size': var mag = Math.abs(o.value), us = ['B', 'KB', 'MB', 'GB', 'TB'], k = 0; while (mag >= 1024 && k < 4) { mag /= 1024; k++; } return (o.value < 0 ? '-' : '') + mag.toFixed(2).replace(/(?:\.0*|(\.[^0]+)0+)$/, '$1') + us[k]; case 'angle': var d = Math.floor(o.value), min = (o.value - d) * 60; return d + '°' + Math.floor(min) + "'" + ((min % 1) * 60).toFixed(1) + '"'; case 'money': return o.value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); case 'clock': return isNaN(o.value) ? 'bad' : [36e5, 6e4, 1000].map(function (s, i) { return ('0' + Math.floor(o.value / s) % (i ? 60 : 24)).slice(-2); }).join(':'); default: return '?' + o.value; } }
module.exports = { parse: parse, print: print, units: UNITS };
