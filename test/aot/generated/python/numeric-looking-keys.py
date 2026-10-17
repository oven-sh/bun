#!/usr/bin/env python3
"""numeric-looking-keys.py <seed> [<functions>]: THE KEY IS A NUMBER, A STRING THAT LOOKS LIKE ONE, OR EITHER, and the receiver is an array, a string, a typed array, a dictionary (Record<string, V>, Record<number, V>), a record with names like numbers, an arguments-like object, a Map (where 1 and "1" differ, and -0 is 0). What must hold: a[1] is a["1"] and is not a["01"] | a["1.0"] | a[" 1"] | a["1e0"]; a[-0] is a["0"] and not a["-0"]; a[1e21] is a["1e+21"]; a[0.1 + 0.2] is a["0.30000000000000004"]; 4294967294 is an index and 4294967295 a name. Read, store, `in`, hasOwn, delete, by sites that see one kind of key while warm and another afterwards. Everything seen is written down. Every line as plain Bun's."""
import random, sys
seed = int(sys.argv[1]); count = int(sys.argv[2]) if len(sys.argv) > 2 else 50
R = random.Random(seed)
print('''declare const console: { log(...values: unknown[]): void };
class Key { whole: number; real: number; maybe?: number; text: string; either: number | string; constructor(k: number | string) { const n = Number(k); this.whole = n | 0; this.real = n; if (n === n) this.maybe = n; this.text = String(k); this.either = k; } }
const show = (v: unknown): string => (v === null ? "null" : v === undefined ? "u" : typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "string" ? "'" + v + "'" : String(v));
const KEYS: (number | string)[] = [0, -0, 1, 2, 3, 5, 9, -1, -2, 0.5, 1.5, -0.5, 0.1 + 0.2, NaN, 2147483647, 2147483648, 4294967294, 4294967295, 4294967296, -2147483648, 1e21, 1e-7, Infinity, "0", "-0", "1", "2", "01", "1.0", "1e0", " 1", "1 ", "+1", "0x1", "", "1.5", "-1", "NaN", "4294967294", "4294967295", "1e21", "1e+21", "Infinity", "length", "a"];
const attempt = (f: () => string): string => { try { return f(); } catch (e) { return "THROWS " + (e as Error).name; } };
const keysOf = (o: object): string => Reflect.ownKeys(o).slice(0, 14).map(String).join(".");''')
RECEIVERS = {
 'strings': ('string[]', '["a", "b", "c", "d"]', '"S"', True),
 'ints': ('number[]', '[10, 11, 12, 13]', '77', True),
 'doubles': ('number[]', '[0.5, 1.5, 2.5]', '7.5', True),
 'text': ('string', '"wxyz"', None, False),
 'f64': ('Float64Array', 'new Float64Array([0.5, 1.5, 2.5])', '7.5', True),
 'u8': ('Uint8Array', 'new Uint8Array([1, 2, 3])', '77', True),
 'dictionary': ('Record<string, number>', '{ a: 1, "0": 2, "1": 3, "1.5": 4, "-1": 5, NaN: 6, "01": 7, "-0": 8, "1e+21": 9, Infinity: 10, "": 11, "4294967295": 12 }', '77', True),
 'numbered': ('Record<number, string>', '{ 0: "zero", 1: "one", 2: "two", 1.5: "half", [-1]: "minus", 4294967294: "last", 4294967295: "name" }', '"S"', True),
 'empty': ('Record<string, number>', '{}', '77', True),
 'like': ('{ length: number; [index: number]: string }', '{ length: 2, 0: "x", 1: "y" }', '"S"', True),
}
def key(kind):
    number = ['n', 'n', 'key.real', 'key.whole', '(key.maybe ?? 1e21)', '(key.maybe ?? -0)', '(n + 1)', '(n - 1)', '(n * 1)', '(n * 2)', '(-n)', '(n % 4)', '(n / 2)', 'Math.round(n)', 'Math.floor(n)', '(n | 0)', '(n >>> 0)', '(key.real - key.whole)', '(n * 0)', '(key.whole * -1)']
    text = ['key.text', 'key.text', 'String(n)', '("" + n)', '`${n}`', '(key.text + "")', 'key.text.trim()', 'String(key.whole)', 'n.toString()', '(key.whole + "")']
    either = ['k', 'k', 'key.either', '(typeof k === "number" ? k + 0 : k)', '(typeof k === "string" ? k : k)']
    return R.choice({'number': number, 'text': text, 'either': either, 'mixed': number + text + either}[kind])
for f in range(count):
    name = R.choice(list(RECEIVERS)); T, lit, val, writes = RECEIVERS[name]; kind = R.choice(['number', 'text', 'either', 'mixed', 'mixed'])
    b = ['  const a = %s as %s; const o = a as any; const n = Number(k); let log = "";' % (lit, T) if name != 'text' else '  const a: string = "wxyz"; const o = a as any; const n = Number(k); let log = "";']
    typed_key = lambda: key('number') if name not in ('dictionary', 'empty') else key(R.choice(['number', 'text']))
    for s in range(R.randrange(4, 10)):
        c = R.randrange(14)
        if c < 3: b.append('  log += show(a[%s]) + ",";' % typed_key())
        elif c < 6: b.append('  log += show(o[%s]) + ",";' % key(kind))
        elif c == 6 and writes: b.append('  a[%s] = %s;' % (typed_key(), val))
        elif c == 7 and writes: b.append('  o[%s] = %s;' % (key(kind), val))
        elif c == 8 and name != 'text': b.append('  log += (%s in o ? "I" : "i") + (Object.hasOwn(o, %s) ? "O" : "o") + (Object.prototype.hasOwnProperty.call(o, %s) ? "P" : "p");' % (key(kind), key(kind), key(kind)))
        elif c == 9 and writes and name not in ('f64', 'u8'): b.append('  log += attempt(() => String(delete o[%s]));' % key(kind))
        elif c == 10: b.append('  { const t = o[%s]; log += t === undefined ? "none," : show(t) + ","; }' % key(kind))
        elif c == 11: b.append('  { const m = new Map<unknown, number>([[0, 1], ["0", 2], [1, 3], ["1", 4], [NaN, 5], [1.5, 6]]); log += show(m.get(%s)) + (m.has(%s) ? "H" : "h") + ","; }' % (key(kind), key(kind)))
        elif c == 12 and name != 'text': b.append('  log += keysOf(o) + ";";')
        else: b.append('  log += show(o[%s]) + show(o[%s]) + ",";' % (key('number'), key('text')))
    b.append('  return log + %s;' % ('keysOf(o)' if name != 'text' else '"."'))
    print('function f%d(k: number | string, key: Key): string {\n%s\n}' % (f, '\n'.join(b)))
    warm = R.choice(['i & 3', 'i & 3', 'String(i & 3)', '(i & 1 ? i & 3 : String(i & 3))', '"a"'])
    print('{ let warm = 0; for (let i = 0; i < 200; i++) warm += attempt(() => f%d(%s, new Key(%s))).length; console.log("f%d: " + warm + " " + KEYS.map(k => attempt(() => f%d(k, new Key(k)))).join(" | ")); }' % (f, warm, warm, f, f))
