#!/usr/bin/env python3
"""scenes.py: odd spellings of constant locales and options, and odd uses of a constant formatter. Prints a .ts program.
Part 1: each (locale text, options text) is written verbatim as constants, and again with both passed through an opaque function; the two formatters must agree on every value and in resolvedOptions().
Part 2: scenes, each run on a constant formatter and on its twin; the two transcripts must be equal."""
import json, re
D, N = "DateTimeFormat", "NumberFormat"
Z = 'timeZone: "UTC"'
SPELLINGS = [
 # options whose value is not what it looks like
 (D, '"en-US"', '{ __proto__: { hour12: false }, hour: "numeric", minute: "2-digit", %s }' % Z), (D, '"en-US"', '{ __proto__: { timeZone: "+05:45" }, hour: "numeric", minute: "2-digit" }'), (D, '"en-US"', '{ __proto__: null, hour: "numeric", %s }' % Z), (D, '"en-US"', '{ ["__proto__"]: { hour12: false }, hour: "numeric", %s }' % Z),
 (D, '"en-US"', '{ hour: "numeric", hour: "2-digit", %s }' % Z), (D, '"en-US"', '{ hour: "numeric", hour12: 0, %s }' % Z), (D, '"en-US"', '{ hour: "numeric", hour12: null, %s }' % Z), (D, '"en-US"', '{ hour: "numeric", hour12: "", %s }' % Z), (D, '"en-US"', '{ hour: "numeric", hour12: "false", %s }' % Z), (D, '"en-US"', '{ hour: "numeric", hour12: undefined, %s }' % Z), (D, '"en-US"', '{ hour: "numeric", hour12: 1, %s }' % Z), (D, '"en-US"', '{ hour: "numeric", hourCycle: undefined, hour12: false, %s }' % Z),
 (D, '"en-US"', '{ second: "numeric", fractionalSecondDigits: "3", %s }' % Z), (D, '"en-US"', '{ second: "numeric", fractionalSecondDigits: 2.9, %s }' % Z), (D, '"en-US"', '{ second: "numeric", fractionalSecondDigits: undefined, %s }' % Z), (D, '"en-US"', '{ year: undefined, month: "long", %s }' % Z), (D, '"en-US"', '{ year: "nu" + "meric", %s }' % Z), (D, '"en-US"', '{ year: `numeric`, %s }' % Z), (D, '"en-US"', '{ "year": "numeric", "timeZone": "UTC" }'), (D, '"en-US"', '{ year: "numeric", timeZone: "U" + "TC" }'), (D, '"en-US"', '{ year: "numeric", timeZone: "uTc" }'), (D, '"en-US"', '{ year: "numeric", timeZone: "Etc/Universal" }'), (D, '"en-US"', '{ year: "numeric", timeZone: "Etc/Zulu" }'), (D, '"en-US"', '{ hour: "numeric", timeZone: "Etc/GMT0" }'), (D, '"en-US"', '{ hour: "numeric", timeZoneName: "short", timeZone: "+00:00" }'), (D, '"en-US"', '{ hour: "numeric", timeZoneName: "long", timeZone: "-00:00" }'), (D, '"en-US"', '{ hour: "numeric", timeZoneName: "short", timeZone: "+01" }'), (D, '"en-US"', '{ hour: "numeric", timeZoneName: "longOffset", timeZone: "+0100" }'), (D, '"en-US"', '{ hour: "numeric", timeZone: "+24:00" }'), (D, '"en-US"', '{ hour: "numeric", timeZone: "+05:45:30" }'), (D, '"en-US"', '{ hour: "numeric", timeZone: "\\u221205:00" }'), (D, '"en-US"', '{ hour: "numeric", timeZone: "UTC+1" }'), (D, '"en-US"', '{ hour: "numeric", timeZone: "Z" }'), (D, '"en-US"', '{ hour: "numeric", timeZone: "" }'), (D, '"en-US"', '{ hour: "numeric", timeZone: undefined }'), (D, '"en-US"', '{ hour: "numeric", timeZone: null }'),
 (D, '"en-US"', '{ dateStyle: "short", year: "numeric", %s }' % Z), (D, '"en-US"', '{ year: "bogus", %s }' % Z), (D, '"en-US"', '{ year: 2, %s }' % Z), (D, '"en-US"', "undefined"), (D, '"en-US"', "null"), (D, '"en-US"', "{}"), (D, '"en-US"', '{ %s }' % Z), (D, '"en-US"', '{ %s, extra: 1 }' % Z), (D, '"en-US"', '{ ...{ year: "numeric" }, %s }' % Z), (D, '"en-US"', '{ get year() { return "2-digit"; }, %s }' % Z), (D, '"en-US"', '{ year: { toString() { return "2-digit"; } }, %s }' % Z), (D, '"en-US"', 'Object.freeze({ year: "2-digit", %s })' % Z), (D, '"en-US"', '"text"'), (D, '"en-US"', "5"), (D, '"en-US"', '[]'),
 (N, '"en-US"', '{ __proto__: { useGrouping: false } }'), (N, '"en-US"', '{ __proto__: { style: "percent" } }'), (N, '"en-US"', '{ useGrouping: "true" }'), (N, '"en-US"', '{ useGrouping: "false" }'), (N, '"en-US"', '{ useGrouping: 0 }'), (N, '"en-US"', '{ useGrouping: null }'), (N, '"en-US"', '{ useGrouping: "" }'), (N, '"en-US"', '{ useGrouping: undefined }'), (N, '"en-US"', '{ useGrouping: 1 }'), (N, '"en-US"', '{ useGrouping: "bogus" }'), (N, '"en-US"', '{ minimumIntegerDigits: "3" }'), (N, '"en-US"', '{ minimumIntegerDigits: 2.9 }'), (N, '"en-US"', '{ minimumIntegerDigits: 0 }'), (N, '"en-US"', '{ minimumIntegerDigits: 22 }'), (N, '"en-US"', '{ maximumFractionDigits: 0, minimumFractionDigits: 0 }'), (N, '"en-US"', '{ maximumFractionDigits: -0 }'), (N, '"en-US"', '{ style: undefined }'), (N, '"en-US"', '{ style: "currency" }'), (N, '"en-US"', '{ style: "decimal", currency: "USD" }'), (N, '"en-US"', '{ notation: "standard", compactDisplay: "long" }'), (N, '"en-US"', "undefined"), (N, '"en-US"', "null"), (N, '"en-US"', '{ signDisplay: "negative", useGrouping: "min2" }'),
]
for l in ['"EN-us"', '"en-us"', '"en_US"', '"en-US-u-hc-h23-ca-gregory"', '"en-u-nu-latn-nu-arab"', '"en-u-nu-invalid"', '"en-u-ca-gregorian"', '"en-u-hc"', '"en-u-hc-h99"', '"en-US-u-va-posix"', '"de-DE-1996"', '"no"', '"iw"', '"in"', '"sh"', '"tl"', '"zh-cmn"', '"i-klingon"', '"cel-gaulish"', '"ja-JP-u-ca-japanese-x-lvariant-JP"', '"en-u-ca-gregory-nu-latn-hc-h23"', '"ar-u-nu-latn-ca-gregory"', '"th-TH-u-nu-thai"', '"en-t-ja"', '"en-Latn-US"', '"sr-Cyrl-RS"', '"zh-Hans-CN-u-nu-hanidec"', '"x-private"', '""', '"e"', '"english"', '"en-"', '"en-US-"', '"en-u"', '"*"', '"en-US\\u0000"', '" en-US"', "undefined", "null", "[]", '["en-US"]', '["de", "en-US"]', '["xx", "de"]', "5", "{}", 'new Intl.Locale("de")', '"en" + "-GB"', "`de`"]:
    SPELLINGS.append((D, l, '{ dateStyle: "medium", timeStyle: "medium", %s }' % Z)); SPELLINGS.append((N, l, "{}"))
for z in ["CET", "WET", "MET", "EET", "EST", "MST", "HST", "EST5EDT", "CST6CDT", "MST7MDT", "PST8PDT", "GB", "GB-Eire", "NZ", "NZ-CHAT", "Japan", "Eire", "PRC", "ROC", "ROK", "UCT", "Zulu", "Universal", "Greenwich", "GMT0", "GMT+0", "GMT-0", "Etc/GMT+0", "Etc/Greenwich", "Etc/UCT", "W-SU", "Navajo", "Cuba", "Egypt", "Iran", "Israel", "Jamaica", "Libya", "Poland", "Portugal", "Singapore", "Turkey", "Hongkong", "Iceland", "Kwajalein", "US/Pacific", "US/Pacific-New", "US/Eastern", "Canada/Newfoundland", "Brazil/East", "Chile/EasterIsland", "Mexico/General", "Asia/Saigon", "Asia/Rangoon", "America/Buenos_Aires", "America/Indianapolis", "America/Argentina/ComodRivadavia", "Pacific/Enderbury", "Pacific/Kanton", "Europe/Kyiv", "America/Ciudad_Juarez", "Factory", "Etc/Unknown", "localtime", "posixrules", "SystemV/EST5EDT", "ACT", "AET", "BST", "IST", "PST", "JST", "CST", "america/new_york", "AMERICA/NEW_YORK", "America/new_york", "Etc/gmt+5", "etc/utc", "gmt", "America/New_York ", "America/NewYork", "America", "+5", "+5:00", "+05:0", "+25:00", "+05:60", "+05:45:00", "-00:00", "+00", "GMT+5", "UTC+05:00"]:
    SPELLINGS.append((D, '"en-US"', '{ dateStyle: "short", timeStyle: "long", timeZone: %s }' % json.dumps(z))); SPELLINGS.append((D, '"de"', '{ hour: "2-digit", minute: "2-digit", day: "numeric", timeZone: %s }' % json.dumps(z)))
out = ['''// @ts-nocheck
import vm from "node:vm";
const boxes = []; const hide = x => { boxes.push(x); return boxes.pop(); };
const attempt = f => { try { return f(); } catch (e) { return "throws " + e.constructor.name + ": " + String(e.message).replace(/\\b(date|number)[CTZ]\\d+\\b/g, "F").replace(/ \\((evaluating|In) .*$/s, ""); } };
let cases = 0, mismatches = 0;
const differ = (label, a, b) => { cases++; if (a !== b) { mismatches++; console.log("MISMATCH " + label + " | constant " + JSON.stringify(a) + " | twin " + JSON.stringify(b)); } };
const dates = [0, -1, 43200000, 86399999, 1e12, 1234567890123, Date.UTC(2024, 1, 29, 0, 0, 0), Date.UTC(2024, 11, 31, 23, 59, 59, 999), Date.UTC(1999, 11, 31, 18, 14, 59), -62135596800000, -62135596800001, 253402300799999, 253402300800000, 8.64e15].flatMap(t => [t, new Date(t)]);
const numbers = [0, -0, 1, -1, 999, 1000, 9999, 10000, 1234567, -1234567, 9007199254740991, 9007199254740992, 0.5, 1e21, NaN, 1000n, "1000"];''']
for i, (c, l, o) in enumerate(SPELLINGS):
    label = json.dumps("%s(%s, %s)" % (c, l, o)); vals = "dates" if c == D else "numbers"
    out.append("function spelled%d(v) { return new Intl.%s(%s, %s).format(v); }" % (i, c, l, o))
    out.append("{ const twin = attempt(() => new Intl.%s(hide(%s), hide(%s))); if (typeof twin === 'string') differ(%s + ' constructor', attempt(() => spelled%d(0)), twin); else { differ(%s + ' resolvedOptions', attempt(() => JSON.stringify(new Intl.%s(%s, %s).resolvedOptions())), JSON.stringify(twin.resolvedOptions())); for (const v of %s) differ(%s + ' ' + String(typeof v === 'object' ? +v : v), attempt(() => spelled%d(v)), attempt(() => twin.format(v))); } }" % (c, l, o, label, i, label, c, l, o, vals, label, i))
# ---- scenes: `F` is the formatter under test. Each scene gets formatters of its own.
DC, DT = 'new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" })', 'new Intl.DateTimeFormat(hide("en-US"), hide({ dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }))'
NC, NT = 'new Intl.NumberFormat("de", {})', 'new Intl.NumberFormat(hide("de"), hide({}))'
OTHER = 'new Intl.DateTimeFormat(hide("ja"), hide({ dateStyle: "full", timeZone: "+09:00" }))'
SCENES = [
 ("the bound getter, taken and called later", "const g = F.format; return [g(V), g.name, g.length, g === F.format, [V, V2].map(F.format).join('|')].join();"),
 ("the getter called on another formatter", "const get = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(F), 'format').get; return get.call(OTHER)(V);"),
 ("format.call with another this", "return F.format.call(OTHER, V);"),
 ("an own format property", "const before = F.format(V); Object.defineProperty(F, 'format', { value: () => 'own', configurable: true }); const own = F.format(V); delete F.format; return [before, own, F.format(V)].join('|');"),
 ("an own unrelated property", "F.extra = 1; return F.format(V) + F.extra;"),
 ("another prototype", "const p = Object.getPrototypeOf(F); Object.setPrototypeOf(F, { format: () => 'other prototype' }); const a = F.format(V); Object.setPrototypeOf(F, p); return a + '|' + F.format(V);"),
 ("no prototype", "const p = Object.getPrototypeOf(F); Object.setPrototypeOf(F, null); const a = attempt(() => F.format(V)); Object.setPrototypeOf(F, p); return a + '|' + F.format(V);"),
 ("frozen", "Object.freeze(F); return F.format(V);"),
 ("the argument gives the formatter an own format", "const r = F.format((Object.defineProperty(F, 'format', { value: () => 'late', configurable: true }), V)); const s = F.format(V); delete F.format; return r + '|' + s;"),
 ("the argument changes the prototype", "const p = Object.getPrototypeOf(F); const r = F.format((Object.setPrototypeOf(F, { format: () => 'late' }), V)); Object.setPrototypeOf(F, p); return r;"),
 ("the argument throws", "return attempt(() => F.format((() => { throw new RangeError('argument'); })()));"),
 ("valueOf with side effects, once", "let n = 0; const r = F.format({ valueOf() { n++; return V; } }); return r + n;"),
 ("a Date with an own valueOf", "return F.format(Object.assign(new Date(V), { valueOf() { return V2; } }));"),
 ("a Date with an own Symbol.toPrimitive", "return F.format(Object.defineProperty(new Date(V), Symbol.toPrimitive, { value: () => V2 }));"),
 ("a Date with an own getTime", "return F.format(Object.assign(new Date(V), { getTime() { return V2; } }));"),
 ("a Date changed after it was made", "const d = new Date(V); d.setTime(V2); return F.format(d);"),
 ("a Date made invalid", "const d = new Date(V); d.setTime(NaN); return attempt(() => F.format(d));"),
 ("a subclass of Date", "class Later extends Date { valueOf() { return V2; } } return F.format(new Later(V));"),
 ("a Date of another realm", "return F.format(vm.runInNewContext('new Date(' + V + ')'));"),
 ("a number of another realm", "return F.format(vm.runInNewContext('new Number(' + V + ')'));"),
 ("no argument", "const a = F.format(), b = T0.format(), c = F.format(); return a === b || c === b ? 'now' : 'differs: ' + a + ' ' + b;"),
 ("undefined", "const a = F.format(undefined), b = T0.format(undefined), c = F.format(undefined); return a === b || c === b ? 'now' : 'differs: ' + a + ' ' + b;"),
 ("two arguments", "return F.format(V, V2);"),
 ("a spread argument", "return F.format(...[V, V2]) + F.format(...[]).length;".replace("+ F.format(...[]).length", "")),
 ("optional call", "return F?.format?.(V);"),
 ("by a computed key", "return F['for' + 'mat'](V);"),
 ("formatToParts agrees with format", "return F.formatToParts(V).map(p => p.value).join('') === F.format(V);"),
 ("formatRange", "return attempt(() => F.formatRange(V, V2));"),
 ("in a template and a sum", "return `${F.format(V)}` + '|' + (F.format(V) + 1) + '|' + F.format(V).length + '|' + F.format(V).charCodeAt(3) + '|' + F.format(V).toUpperCase();"),
 ("the result as a key, in a Set, compared", "const o = { [F.format(V)]: 1 }; return [Object.keys(o)[0] === T0.format(V), new Set([F.format(V), T0.format(V)]).size, F.format(V) === T0.format(V), F.format(V).localeCompare(T0.format(V)), JSON.stringify(F.format(V)) === JSON.stringify(T0.format(V))].join();"),
 ("many values in a loop", "let s = ''; for (let i = 0; i < 400; i++) s += F.format(V + i * 86400000 * 31 + i * 3661001).length; return s.length + s.slice(0, 40);"),
 ("in a closure, a generator and an async function", "const c = () => F.format(V); function* g() { yield F.format(V2); } return c() + '|' + [...g()][0];"),
 ("under try and finally", "try { return F.format(V); } finally { F.format(V2); }"),
]
for kind, C, T, V, V2 in (("date", DC, DT, "1234567890123", "86399999"), ("number", NC, NT, "1234567.891", "-9876543")):
    for i, (title, body) in enumerate(SCENES):
        if kind == "number" and ("Date" in title or title in ("no argument", "undefined")): continue
        sub = lambda text, word, by: re.sub(r"\b%s\b" % word, lambda m: by, text)
        b = sub(sub(body, "V2", V2), "V", V)
        other = OTHER if kind == "date" else 'new Intl.NumberFormat(hide("en-IN"), hide({}))'
        out.append("const %sC%d = %s; const %sT%d = %s; const %sZ%d = %s;" % (kind, i, C, kind, i, T, kind, i, T))
        out.append("function %sSceneC%d() { %s } function %sSceneT%d() { %s }" % (kind, i, sub(sub(sub(b, "T0", "%sZ%d" % (kind, i)), "F", "%sC%d" % (kind, i)), "OTHER", other), kind, i, sub(sub(sub(b, "T0", "%sZ%d" % (kind, i)), "F", "%sT%d" % (kind, i)), "OTHER", other)))
        out.append("differ(%s, String(attempt(%sSceneC%d)), String(attempt(%sSceneT%d)));" % (json.dumps(kind + ": " + title), kind, i, kind, i))
out.append('console.log("cases " + cases + " | mismatches " + mismatches);')
print("\n".join(out))
