#!/usr/bin/env python3
"""non-escaping-objects.py <seed> [<functions>]: straight-line untyped JavaScript in which NOTHING ESCAPES: a few local literals a function, and random statements WRITTEN WITH STATIC NAMES that a flow analysis can see to the end: stores, deletes, members added, computed keys that are constants, spreads, Object.assign | freeze | seal | preventExtensions | defineProperty | setPrototypeOf | create | keys | values | entries, arrays, Maps, closures, joins by ?:, loops over two objects, swaps, and small readers shared by the whole program (one a name), so that the families of many functions meet. After each statement something is looked at. Every line must be as plain Bun's."""
import random, sys
seed = int(sys.argv[1]); count = int(sys.argv[2]) if len(sys.argv) > 2 else 120
R = random.Random(seed)
N = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
def val(vs):
    k = R.randrange(12) if vs else R.randrange(10)
    return ['1', '2.5', '"s"', 'null', 'undefined', 'true', '[1, 2]', '{ a: 1 }', '{ b: "x", a: 2 }', '() => 7'][k] if k < 10 or not vs else R.choice(vs)
def lit(vs):
    names = R.sample(N, R.randrange(0, 6))
    return '{ ' + ', '.join('%s: %s' % (n, val(vs)) for n in names) + ' }'
out = ['''const show = (v, depth = 0) => (v === null ? "null" : typeof v === "object" ? (depth > 1 ? "~" : Array.isArray(v) ? "[" + v.map(x => show(x, depth + 1)).join() + "]" : v instanceof Map ? "M" + v.size : "{" + Object.keys(v).map(key => key + ":" + show(v[key], depth + 1)).join() + "}") : typeof v === "function" ? "fn" : typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
''']
for n in N:
    out.append('function read_%s(o) { return o.%s; }\nfunction write_%s(o, v) { o.%s = v; return o; }\nfunction has_%s(o) { return "%s" in o; }\n' % ((n,) * 6))
for f in range(count):
    vs = ['v0', 'v1', 'v2']
    body = ['  let log = "";', '  let v0 = %s, v1 = %s, v2 = %s;' % (lit([]) , lit([]), lit([])), '  const list = [], map = new Map(); const key = "%s";' % R.choice(N)]
    for s in range(R.randrange(6, 16)):
        v, w = R.choice(vs), R.choice(vs); n, m = R.choice(N), R.choice(N)
        st = R.choice([
            '%s.%s = %s;' % (v, n, val(vs)), '%s.%s = %s;' % (v, n, val(vs)), 'delete %s.%s;' % (v, n), 'delete %s.%s; %s.%s = %s;' % (v, n, v, n, val(vs)), '%s["%s"] = %s;' % (v, n, val(vs)), '%s[key] = %s;' % (v, val(vs)), 'delete %s[key];' % v,
            '%s = { ...%s, %s: %s };' % (v, w, n, val(vs)), '%s = { %s: %s, ...%s };' % (v, n, val(vs), w), '%s = { ...%s, ...%s };' % (v, v, w), 'Object.assign(%s, %s);' % (v, w), '%s = Object.assign({}, %s, %s);' % (v, v, w), '%s = Object.assign({ %s: 0 }, %s);' % (v, n, w),
            'Object.freeze(%s);' % v, 'Object.seal(%s);' % v, 'Object.preventExtensions(%s);' % v,
            'Object.defineProperty(%s, "%s", { get() { return "got"; }, enumerable: true, configurable: true });' % (v, n), 'Object.defineProperty(%s, "%s", { value: %s, writable: false, enumerable: true, configurable: true });' % (v, n, val(vs)), 'Object.defineProperty(%s, "%s", { value: %s, writable: true, enumerable: false, configurable: true });' % (v, n, val(vs)),
            'if (%s !== %s) Object.setPrototypeOf(%s, %s);' % (v, w, v, w), '%s = Object.create(%s);' % (v, w), 'Object.setPrototypeOf(%s, null);' % v,
            'list.push(%s); log += show(list[list.length - 1].%s);' % (v, n), 'if (list.length) { %s = list.pop(); }' % v, 'log += list.map(x => show(x.%s)).join();' % n, 'map.set("%s", %s); log += show(map.get("%s").%s);' % (n, v, n, m), 'if (map.has("%s")) %s = map.get("%s");' % (n, v, n),
            '{ const g = () => %s.%s; log += show(g()); }' % (v, n), '{ const g = x => { x.%s = %s; }; g(%s); }' % (n, val(vs), v), '{ const j = log.length %% 2 ? %s : %s; log += show(j.%s); j.%s = %s; }' % (v, w, n, m, val(vs)),
            'for (const x of [%s, %s]) log += show(x.%s);' % (v, w, n), '[%s, %s] = [%s, %s];' % (v, w, w, v), 'log += show(read_%s(%s));' % (n, v), 'write_%s(%s, %s);' % (n, v, val(vs)), 'log += has_%s(%s);' % (n, v),
            'log += JSON.stringify(%s);' % v, 'log += Object.keys(%s).join();' % v, 'log += Object.values(%s).map(x => show(x)).join();' % v, 'log += Object.entries(%s).map(p => p[0] + show(p[1])).join();' % v, 'for (const k in %s) log += k + show(%s[k]);' % (v, v),
            'log += ("%s" in %s) + "" + Object.prototype.hasOwnProperty.call(%s, "%s");' % (n, v, v, n), 'log += show(%s.%s?.%s);' % (v, n, m), 'log += typeof %s.%s;' % (v, n), '{ const { %s, ...rest } = %s; log += show(%s) + show(rest); }' % (n, v, n), '%s.%s = %s; log += show(%s.%s.%s);' % (v, n, w, v, n, m),
            '%s.%s ??= %s;' % (v, n, val(vs)), 'if (typeof %s.%s !== "function") %s.%s += 1;' % (v, n, v, n), 'log += show(%s.%s === %s.%s);' % (v, n, w, n), '%s = %s;' % (v, lit(vs)), 'log += show(typeof %s.%s === "function" ? %s.%s() : 0);' % (v, n, v, n),
        ])
        body.append('  try { %s } catch (e) { log += "!" + e.name; }' % st)
        if R.random() < 0.4: body.append('  log += "|" + show(%s);' % R.choice(vs))
    body.append('  return log + "#" + show(v0) + show(v1) + show(v2) + Object.keys(v0).join() + "/" + Object.keys(v1).join() + "/" + Object.keys(v2).join();')
    out.append('function f%d() {\n%s\n}\n' % (f, '\n'.join(body)))
out.append('for (const f of [%s]) { let text; try { text = f(); } catch (e) { text = "THROWN " + e.name; } console.log(f.name + ": " + text); }\n' % ', '.join('f%d' % f for f in range(count)))
print(''.join(out), end='')
