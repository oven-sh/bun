#!/usr/bin/env python3
"""strings-compared-with-literals.py <seed> [<functions>]: functions that compare ONE value (typed any | unknown | string | a union with strings) with LITERALS of the lengths 0 1 2 3 4 5 7 8 9 12 15 16 17 24 31 32 33 40, 8-bit and 16-bit, by === !== == != switch, includes-lists, ?: chains, Map and Set lookups and object keys; the values: each literal itself, and the same text made at run time eight ways (sliced, joined, a rope cut at every third place, out of char codes, a 16-bit buffer holding only Latin-1, out of JSON, out of a template, padded and trimmed), its near misses (first | middle | last character changed, one shorter, one longer, the other case, a NUL inside, the 16-bit look-alike), and what is no string (String objects, objects with toString | valueOf, numbers for numeric literals, null, undefined, booleans, symbols, arrays of one string). Every line as plain Bun's."""
import random, sys, json
seed = int(sys.argv[1]); count = int(sys.argv[2]) if len(sys.argv) > 2 else 40
R = random.Random(seed)
ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-./ '
def lit(n, wide):
    s = ''.join(R.choice(ALPHA) for _ in range(n))
    if wide and n: i = R.randrange(n); s = s[:i] + R.choice('日é€ſ😀'[:4]) + s[i + 1:]
    return s
FIXED = ['', '0', '1', '-1', '1.5', 'NaN', 'null', 'undefined', 'true', 'false', '[object Object]', 'a', 'type', 'string', 'number', 'function', 'constructor', 'identifier', 'StringLiteral', 'NumericLiteral']
print('''declare const console: { log(...values: unknown[]): void };
const attempt = (f: () => string): string => { try { return f(); } catch (e) { return "T:" + (e as Error).name; } };
const codes = (s: string): string => { let o = ""; for (let i = 0; i < s.length; i++) o += String.fromCharCode(s.charCodeAt(i)); return o; };
function forms(s: string): unknown[] {
  const n = s.length, mid = n >> 1, out: unknown[] = [s, ("x" + s).slice(1), s.split("").join(""), codes(s), (s + "\\u65e5").slice(0, n), JSON.parse(JSON.stringify(s)), `${s}`, (" " + s + " ").slice(1, -1), s.padEnd(n + 2).slice(0, n)];
  for (let k = 1; k < n; k += 3) out.push(s.slice(0, k) + s.slice(k));
  if (n) out.push("~" + s.slice(1), s.slice(0, mid) + "~" + s.slice(mid + 1), s.slice(0, n - 1) + "~", s.slice(0, n - 1), s.slice(1), s.toUpperCase(), s.toLowerCase(), s.slice(0, mid) + "\\0" + s.slice(mid + 1), s.slice(0, n - 1) + "\\u0100");
  out.push(s + "x", s + "\\0", s + s, new String(s), { toString: () => s }, { valueOf: () => s }, [s], Number(s), s === "true", null, undefined, Symbol.for(s));
  return out;
}''')
for f in range(count):
    lens = R.sample([0, 1, 2, 3, 4, 5, 7, 8, 9, 12, 15, 16, 17, 24, 31, 32, 33, 40], R.randrange(2, 6))
    ls = [lit(n, R.random() < 0.2) for n in lens] + R.sample(FIXED, R.randrange(0, 4))
    if R.random() < 0.5 and len(ls[0]) > 1: ls.append(ls[0][:-1] + ('Z' if ls[0][-1] != 'Z' else 'Y'))   # two literals of one length that differ at the end
    if R.random() < 0.3 and len(ls[0]) > 1: ls.append(('Z' if ls[0][0] != 'Z' else 'Y') + ls[0][1:])
    ls = list(dict.fromkeys(ls)); J = lambda s: json.dumps(s, ensure_ascii=False)
    T = R.choice(['any', 'any', 'unknown', 'unknown', 'string', 'string | number | null | undefined', 'string | undefined'])
    b = []; shape = R.randrange(8)
    if shape == 0: b.append('  return ' + ' + '.join('(v === %s ? "%d" : "-")' % (J(l), i) for i, l in enumerate(ls)) + ';')
    elif shape == 1: b.append('  switch (v) { ' + ' '.join('case %s: return "%d";' % (J(l), i) for i, l in enumerate(ls)) + ' default: return "-"; }')
    elif shape == 2: b.append('  return ' + ' + '.join('(v == %s ? "%d" : "-")' % (J(l), i) for i, l in enumerate(ls)) + ';')
    elif shape == 3: b.append('  return ' + ' + '.join('(v !== %s ? "-" : "%d")' % (J(l), i) for i, l in enumerate(ls)) + ' + ' + ' + '.join('(v != %s ? "-" : "%d")' % (J(l), i) for i, l in enumerate(ls)) + ';')
    elif shape == 4: b.append('  if (' + ' || '.join('v === %s' % J(l) for l in ls[:len(ls) // 2 + 1]) + ') return "first"; if (' + ' || '.join('v === %s' % J(l) for l in ls[len(ls) // 2:]) + ') return "second"; return "-";')
    elif shape == 5: b.append('  return String([%s].includes(v as never)) + [%s].indexOf(v as never);' % (', '.join(J(l) for l in ls), ', '.join(J(l) for l in ls)))
    elif shape == 6: b.append('  return typeof v === "string" ? ' + ' '.join('v === %s ? "%d" :' % (J(l), i) for i, l in enumerate(ls)) + ' "s" + v.length : "-";')
    else: b.append('  return String(table%d.get(v)) + set%d.has(v) + (typeof v === "string" ? String(record%d[v]) : "-");' % (f, f, f)); print('const table%d = new Map<unknown, number>([%s]); const set%d = new Set<unknown>([%s]); const record%d: Record<string, number> = { %s };' % (f, ', '.join('[%s, %d]' % (J(l), i) for i, l in enumerate(ls)), f, ', '.join(J(l) for l in ls), f, ', '.join('%s: %d' % (J(l), i) for i, l in enumerate(ls))))
    print('function f%d(v: %s): string {\n%s\n}' % (f, T, '\n'.join(b)))
    print('{ const literals: string[] = [%s]; for (let i = 0; i < 200; i++) f%d(literals[i %% literals.length] as never); console.log("f%d: " + literals.map(l => forms(l).filter(v => %s).map(v => attempt(() => f%d(v as never))).join("")).join(" ")); }' % (', '.join(J(l) for l in ls), f, f, {'any': 'true', 'unknown': 'true', 'string': 'typeof v === "string"', 'string | undefined': 'typeof v === "string" || v === undefined', 'string | number | null | undefined': 'typeof v === "string" || typeof v === "number" || v === null || v === undefined'}[T], f))
