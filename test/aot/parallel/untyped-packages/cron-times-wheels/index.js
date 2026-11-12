// schedules of minutes, hours, days, months and weekdays; the next times, names, steps, lists and a wheel of timers on a made clock
'use strict';
var FIELDS = [['minute', 0, 59], ['hour', 0, 23], ['day', 1, 31], ['month', 1, 12, 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ')], ['weekday', 0, 7, 'sun mon tue wed thu fri sat'.split(' ')]];
var MACROS = { '@yearly': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@hourly': '0 * * * *' };
function parseField(text, f) {
  var set = [], lo = f[1], hi = f[2];
  text.toLowerCase().split(',').forEach(function (part) {
    var m = /^(?:(\*)|(\d+|[a-z]{3})(?:-(\d+|[a-z]{3}))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error('bad ' + f[0] + ': ' + part);
    function num(s, i) { if (/^\d+$/.test(s)) return +s; var at = f[3] ? f[3].indexOf(s) : -1; if (at < 0) throw new Error('bad name ' + s + ' in ' + f[0]); return at + (f[0] === 'month' ? 1 : 0); }
    var a = m[1] ? lo : num(m[2]), b = m[1] ? hi : m[3] !== undefined ? num(m[3]) : m[4] !== undefined ? hi : a, step = m[4] === undefined ? 1 : +m[4];
    if (a < lo || b > hi || a > b || step < 1) throw new Error('out of range ' + f[0] + ': ' + part);
    for (var v = a; v <= b; v += step) { var x = f[0] === 'weekday' && v === 7 ? 0 : v; if (set.indexOf(x) < 0) set.push(x); }
  });
  return set.sort(function (p, q) { return p - q; });
}
function Cron(text) { var parts = (MACROS.hasOwnProperty(text) ? MACROS[text] : text).trim().split(/\s+/); if (parts.length !== 5) throw new Error('expected 5 fields, got ' + parts.length); this.text = text; this.anyDay = parts[2] === '*'; this.anyWeek = parts[4] === '*'; for (var i = 0; i < 5; i++) this[FIELDS[i][0]] = parseField(parts[i], FIELDS[i]); }
Cron.prototype.dayFits = function (d) { var a = this.day.indexOf(d.getUTCDate()) >= 0, b = this.weekday.indexOf(d.getUTCDay()) >= 0; return this.anyDay && this.anyWeek ? true : this.anyDay ? b : this.anyWeek ? a : a || b; };
Cron.prototype.next = function (from) { var d = new Date(+from); d.setUTCSeconds(0, 0); d.setUTCMinutes(d.getUTCMinutes() + 1); var limit = d.getUTCFullYear() + 5; for (var n = 0; n < 5000; n++) { if (d.getUTCFullYear() > limit) return null; if (this.month.indexOf(d.getUTCMonth() + 1) < 0) { d.setUTCMonth(d.getUTCMonth() + 1, 1); d.setUTCHours(0, 0); continue; } if (!this.dayFits(d)) { d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(0, 0); continue; } if (this.hour.indexOf(d.getUTCHours()) < 0) { d.setUTCHours(d.getUTCHours() + 1, 0); continue; } if (this.minute.indexOf(d.getUTCMinutes()) < 0) { d.setUTCMinutes(d.getUTCMinutes() + 1); continue; } return d; } return null; };
Cron.prototype.list = function (from, n) { var out = []; for (var t = from; n-- > 0;) { t = this.next(t); if (!t) break; out.push(t.toISOString().slice(0, 16)); } return out; };
function Wheel(size, tick) { this.size = size; this.tick = tick; this.slots = []; for (var i = 0; i < size; i++) this.slots.push([]); this.now = 0; this.at = 0; this.ids = 0; this.live = {}; }
Wheel.prototype.add = function (delay, fn, every) { var ticks = Math.max(1, Math.ceil(delay / this.tick)), t = { id: ++this.ids, rounds: Math.floor((ticks - 1) / this.size), fn: fn, every: every ? delay : 0 }; this.slots[(this.at + ticks) % this.size].push(t); this.live[t.id] = t; return t.id; };
Wheel.prototype.cancel = function (id) { if (!this.live[id]) return false; this.live[id].fn = null; return delete this.live[id]; };
Wheel.prototype.advance = function (ms) { var fired = 0; for (var end = this.now + ms; this.now < end; this.now += this.tick) { this.at = (this.at + 1) % this.size; var list = this.slots[this.at]; this.slots[this.at] = []; for (var i = 0; i < list.length; i++) { var t = list[i]; if (!t.fn) continue; if (t.rounds-- > 0) { this.slots[this.at].push(t); continue; } fired++; delete this.live[t.id]; t.fn.call(this, t.id); if (t.every && t.fn) { var id = this.add(t.every, t.fn, true); } } } return fired; };
function Bucket(rate, burst, clock) { this.rate = rate; this.burst = burst; this.clock = clock; this.tokens = burst; this.last = clock(); }
Bucket.prototype.take = function (n) { var t = this.clock(); this.tokens = Math.min(this.burst, this.tokens + (t - this.last) / 1000 * this.rate); this.last = t; if (this.tokens < n) return Math.ceil((n - this.tokens) / this.rate * 1000); this.tokens -= n; return 0; };
module.exports = { Cron: Cron, Wheel: Wheel, Bucket: Bucket };
