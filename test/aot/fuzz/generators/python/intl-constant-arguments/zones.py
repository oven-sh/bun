#!/usr/bin/env python3
"""zones.py <part> <parts> | default: constant date formatters with a named time zone (or, with `default`, with no timeZone option), each against a twin whose arguments are not constants.
The program finds every offset change of each zone from 1850 to 2110 itself (a daily scan with a non-constant formatter, then bisection to the millisecond) and compares at each change, 1 ms, 1 s, 1 h and 1 day either side,
first in ascending order, then shuffled (the fast path caches one offset range), plus far past, far future and pseudo-random values. toLocaleString, toLocaleDateString and toLocaleTimeString with the same constants are compared too."""
import sys, json
ZONES = ["America/New_York", "America/Los_Angeles", "America/St_Johns", "America/Sao_Paulo", "America/Havana", "America/Santiago", "America/Asuncion", "America/Caracas", "America/Argentina/Buenos_Aires", "America/Nuuk", "America/Godthab", "America/Scoresbysund", "America/Mexico_City", "America/Phoenix", "America/Anchorage", "America/Juneau", "America/Metlakatla", "America/Guyana", "America/Paramaribo", "America/Montevideo", "America/Noronha", "America/Miquelon",
 "Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Moscow", "Europe/Istanbul", "Europe/Lisbon", "Europe/Amsterdam", "Europe/Kyiv", "Europe/Kiev", "Europe/Volgograd", "Europe/Samara", "Europe/Chisinau", "Europe/Riga",
 "Africa/Casablanca", "Africa/El_Aaiun", "Africa/Cairo", "Africa/Monrovia", "Africa/Juba", "Africa/Windhoek", "Africa/Lagos", "Africa/Sao_Tome", "Africa/Tripoli",
 "Asia/Kathmandu", "Asia/Katmandu", "Asia/Kolkata", "Asia/Calcutta", "Asia/Tehran", "Asia/Pyongyang", "Asia/Tokyo", "Asia/Shanghai", "Asia/Gaza", "Asia/Hebron", "Asia/Amman", "Asia/Damascus", "Asia/Dhaka", "Asia/Yangon", "Asia/Colombo", "Asia/Manila", "Asia/Singapore", "Asia/Ho_Chi_Minh", "Asia/Kabul", "Asia/Thimphu", "Asia/Almaty", "Asia/Qyzylorda",
 "Australia/Lord_Howe", "Australia/Adelaide", "Australia/Eucla", "Australia/Sydney", "Australia/Perth", "Pacific/Apia", "Pacific/Kiritimati", "Pacific/Chatham", "Pacific/Tongatapu", "Pacific/Norfolk", "Pacific/Fiji", "Pacific/Auckland", "Pacific/Marquesas", "Pacific/Kwajalein", "Pacific/Fakaofo", "Pacific/Easter", "Pacific/Nauru", "Pacific/Niue", "Pacific/Bougainville",
 "Antarctica/Troll", "Antarctica/Casey", "Antarctica/Macquarie", "Antarctica/Vostok", "Atlantic/Azores", "Atlantic/Reykjavik", "Atlantic/Stanley", "Indian/Chagos", "US/Pacific", "EST", "MST", "HST", "CET", "WET", "GB", "NZ", "Japan", "Eire", "Etc/GMT+12", "Etc/GMT-14", "america/new_york", "AMERICA/NEW_YORK", "Asia/kolkata"]
SETS = [("en-US", {"dateStyle": "short", "timeStyle": "medium"}), ("de", {"year": "numeric", "month": "2-digit", "day": "2-digit", "hour": "2-digit", "minute": "2-digit", "second": "2-digit", "fractionalSecondDigits": 3}), ("ja", {"dateStyle": "full"}), ("en-GB", {"weekday": "short", "hour": "numeric", "minute": "2-digit", "hourCycle": "h11"}), ("fr", {"timeStyle": "short"}), ("en-US", {"hour": "numeric", "timeZoneName": "short"})]
def obj(d): return "{ " + ", ".join("%s: %s" % (k, json.dumps(v)) for k, v in d.items()) + " }"
default = sys.argv[1] == "default"
mine = [None] if default else [z for i, z in enumerate(ZONES) if i % int(sys.argv[2]) == int(sys.argv[1])]
out = ['''// @ts-nocheck
const boxes = []; const hide = x => { boxes.push(x); return boxes.pop(); };
const attempt = f => { try { return f(); } catch (e) { return "throws " + e.constructor.name; } };
let formatters = 0, comparisons = 0, mismatches = 0, changes = 0, state = 88172645463325252n;
const random = () => { state ^= (state << 13n) & 0xffffffffffffffffn; state ^= state >> 7n; state ^= (state << 17n) & 0xffffffffffffffffn; return Number(state >> 11n) / 9007199254740992; };
const differ = (label, v, a, b) => { comparisons++; if (a !== b && ++mismatches <= 60) console.log("MISMATCH " + label + " | " + v + " (" + attempt(() => new Date(v).toISOString()) + ") | constant " + JSON.stringify(a) + " | twin " + JSON.stringify(b)); };
const DAY = 86400000;
function valuesFor(zone) {
  const probe = new Intl.DateTimeFormat(hide("en-US"), hide(zone === undefined ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" } : { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: zone }));
  const at = t => probe.format(t - (((t % DAY) + DAY) % DAY) + 0) ;
  const clock = t => { const s = probe.format(t), l = (+s.slice(0, 2)) * 3600 + (+s.slice(3, 5)) * 60 + (+s.slice(6, 8)), u = Math.floor((((t % DAY) + DAY) % DAY) / 1000); return (((l - u) % 86400) + 86400) % 86400; };
  const found = [];
  let before = clock(Date.UTC(1850, 0, 1));
  for (let t = Date.UTC(1850, 0, 2); t < Date.UTC(2110, 0, 1); t += DAY) {
    const now = clock(t);
    if (now !== before) { let lo = t - DAY, hi = t; while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (clock(mid) === before) lo = mid; else hi = mid; } found.push(hi); before = clock(t); }
  }
  changes += found.length;
  const values = [];
  for (const t of found) for (const d of [-DAY, -3600000, -1000, -1, 0, 1, 1000, 3600000, DAY]) values.push(t + d);
  for (const t of [-8.64e15, -62135596800000 - DAY, -62135596800000, -62135596800000 + DAY, Date.UTC(1000, 5, 1), Date.UTC(1849, 11, 31), 0, Date.UTC(2200, 2, 10, 10), Date.UTC(2200, 6, 1), Date.UTC(3000, 9, 30, 1), Date.UTC(9999, 11, 31, 23, 59, 59, 999), Date.UTC(10000, 0, 1), Date.UTC(100000, 6, 1), 8.64e15 - DAY, 8.64e15, NaN]) values.push(t);
  for (let i = 0; i < 1500; i++) values.push(Math.floor(Date.UTC(1850, 0, 1) + random() * (Date.UTC(2110, 0, 1) - Date.UTC(1850, 0, 1))));
  for (let i = 0; i < 300; i++) values.push(Math.floor((random() * 2 - 1) * 8.64e15));
  const shuffled = values.slice(); for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  return values.concat(shuffled);
}''']
n = 0
for z in mine:
    out.append("{ const values = valuesFor(%s);" % ("undefined" if z is None else json.dumps(z)))
    body = []
    for l, o in SETS:
        o = dict(o) if z is None else dict(o, timeZone=z); n += 1; label = json.dumps(l + " " + json.dumps(o))
        out.insert(1 + 0, "") if False else None
        body.append((n, l, o, label))
        out.append("  formatters++; for (const v of values) { const twin = attempt(() => t%d.format(v)); differ(%s, v, attempt(() => kept%d(v)), twin); }" % (n, label, n))
        out.append("  for (let i = 0; i < values.length; i += 3) { const d = new Date(values[i]); differ('toLocaleString ' + %s, values[i], attempt(() => whole%d(d)), attempt(() => d.toLocaleString(hide(%s), hide(%s)))); }" % (label, n, json.dumps(l), obj(o)))
        if "timeStyle" not in o and "hour" not in o: out.append("  for (let i = 1; i < values.length; i += 3) { const d = new Date(values[i]); differ('toLocaleDateString ' + %s, values[i], attempt(() => day%d(d)), attempt(() => d.toLocaleDateString(hide(%s), hide(%s)))); }" % (label, n, json.dumps(l), obj(o)))
        if "dateStyle" not in o and "year" not in o and "weekday" not in o: out.append("  for (let i = 2; i < values.length; i += 3) { const d = new Date(values[i]); differ('toLocaleTimeString ' + %s, values[i], attempt(() => time%d(d)), attempt(() => d.toLocaleTimeString(hide(%s), hide(%s)))); }" % (label, n, json.dumps(l), obj(o)))
    out.append("}")
    for k, l, o, label in body:
        out.append("var f%d, t%d;" % (k, k)) if False else None
head = []
n = 0
for z in mine:
    for l, o in SETS:
        o = dict(o) if z is None else dict(o, timeZone=z); n += 1
        head.append("const f%d = new Intl.DateTimeFormat(%s, %s); const t%d = new Intl.DateTimeFormat(hide(%s), hide(%s));" % (n, json.dumps(l), obj(o), n, json.dumps(l), obj(o)))
        head.append("function kept%d(v) { return f%d.format(v); } function whole%d(d) { return d.toLocaleString(%s, %s); } function day%d(d) { return d.toLocaleDateString(%s, %s); } function time%d(d) { return d.toLocaleTimeString(%s, %s); }" % (n, n, n, json.dumps(l), obj(o), n, json.dumps(l), obj(o), n, json.dumps(l), obj(o)))
out = out[:1] + head + out[1:]
out.append('console.log("zone " + new Intl.DateTimeFormat().resolvedOptions().timeZone + " | offset changes found " + changes + " | formatters " + formatters + " | comparisons " + comparisons + " | mismatches " + mismatches);')
print("\n".join(x for x in out if x))
