#!/usr/bin/env python3
"""unescaped-objects-with-own-names.py <seed> [<functions>]: as non-escaping-objects.py, made so that a flow analysis can follow it to the end: each function has names, readers and writers OF ITS OWN, no try, no shared printer, nothing that throws: literals of numbers, strings, booleans, null and nested literals; stores of other kinds over them, members added, deleted, added again, spreads, Object.assign | keys | values | entries, arrays, Maps, closures, joins, loops, swaps, parameters, results. What is looked at is written out member by member by static names. Every line must be as plain Bun's."""
import random, sys
seed = int(sys.argv[1]); count = int(sys.argv[2]) if len(sys.argv) > 2 else 150
R = random.Random(seed)
out = []
for f in range(count):
    N = ['a%d' % f, 'b%d' % f, 'c%d' % f, 'd%d' % f, 'e%d' % f]
    vs = ['v0', 'v1', 'v2']
    def prim(): return R.choice(['1', '2.5', '-0', '"s"', '""', 'null', 'undefined', 'true', 'false', '1e21', '7'])
    def lit(depth=0):
        names = R.sample(N, R.randrange(1, 5))
        return '{ ' + ', '.join('%s: %s' % (n, lit(1) if depth == 0 and R.random() < 0.2 else prim()) for n in names) + ' }'
    look = lambda v: ' + "," + '.join('String(%s.%s)' % (v, n) for n in N)
    b = ['  let log = "";', '  let v0 = %s, v1 = %s, v2 = %s;' % (lit(), lit(), lit()), '  const list = [], map = new Map();']
    b.append('  const read = o => String(o.%s) + String(o.%s); const write = (o, x) => { o.%s = x; return o; }; const pick = (c, p, q) => (c ? p : q); const make = x => ({ %s: x, %s: "made" });' % (N[0], N[1], N[2], N[3], N[0]))
    for s in range(R.randrange(5, 14)):
        v, w = R.choice(vs), R.choice(vs); n, m = R.choice(N), R.choice(N)
        b.append('  ' + R.choice([
            '%s.%s = %s;' % (v, n, prim()), '%s.%s = %s;' % (v, n, prim()), '%s.%s = %s;' % (v, n, lit(1)), 'delete %s.%s;' % (v, n), 'delete %s.%s; %s.%s = %s;' % (v, n, v, n, prim()), '%s["%s"] = %s;' % (v, n, prim()),
            '%s = { ...%s, %s: %s };' % (v, w, n, prim()), '%s = { %s: %s, ...%s };' % (v, n, prim(), w), '%s = { ...%s, ...%s };' % (v, v, w), 'Object.assign(%s, %s);' % (v, w), '%s = Object.assign({}, %s, %s);' % (v, v, w),
            'list.push(%s); log += String(list[list.length - 1].%s);' % (v, n), 'if (list.length) %s = list.pop();' % v, 'log += list.map(x => String(x.%s)).join();' % n, 'list.forEach(x => { x.%s = %s; });' % (n, prim()), 'for (const x of list) log += String(x.%s);' % n,
            'map.set("%s", %s); log += String(map.get("%s").%s);' % (n, v, n, m), 'if (map.has("%s")) %s = map.get("%s");' % (n, v, n), 'for (const x of map.values()) log += String(x.%s);' % n,
            '{ const g = () => %s.%s; log += String(g()); }' % (v, n), '{ const j = pick(log.length %% 2 === 0, %s, %s); log += String(j.%s); j.%s = %s; }' % (v, w, n, m, prim()), 'for (const x of [%s, %s]) log += String(x.%s);' % (v, w, n), '[%s, %s] = [%s, %s];' % (v, w, w, v),
            'log += read(%s);' % v, 'write(%s, %s);' % (v, prim()), '%s = write(%s, %s);' % (v, w, prim()), '%s = make(%s);' % (v, prim()), '%s = make(%s);' % (v, w), 'log += Object.keys(%s).join();' % v, 'log += Object.values(%s).map(String).join();' % v, 'log += Object.entries(%s).map(p => p[0] + String(p[1])).join();' % v, 'for (const k in %s) log += k;' % v,
            'log += ("%s" in %s);' % (n, v), 'log += typeof %s.%s;' % (v, n), '{ const { %s: taken, ...rest } = %s; log += String(taken) + Object.keys(rest).join(); }' % (n, v), '%s.%s = %s; log += String(%s.%s.%s);' % (v, n, w, v, n, m), '%s.%s ??= %s;' % (v, n, prim()), 'log += String(%s.%s === %s.%s);' % (v, n, w, n), '%s = %s;' % (v, lit()),
            'log += String(%s.%s + 1);' % (v, n), 'if (%s.%s) log += "t"; else log += "f";' % (v, n), 'log += JSON.stringify(%s, (key, x) => (key !== "" && typeof x === "object" && x !== null ? "o" : x));' % v,
        ]))
        if R.random() < 0.35: b.append('  log += "|" + %s;' % look(R.choice(vs)))
    b.append('  return log + "#" + %s + "#" + %s + "#" + %s + "#" + Object.keys(v0).join() + "/" + Object.keys(v1).join() + "/" + Object.keys(v2).join();' % (look('v0'), look('v1'), look('v2')))
    out.append('function f%d() {\n%s\n}\nconsole.log("f%d: " + f%d());\n' % (f, '\n'.join(b), f, f))
print(''.join(out), end='')
