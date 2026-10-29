#!/usr/bin/env python3
"""for-in-loop-bodies.py <seed> [<functions>]: RANDOM BODIES OF for-in LOOPS: up to four things made from the key at the start (o[k], Object.hasOwn, typeof, in, a sum, a flag), then up to four statements out of: nested while | for | do | for-of | for-in loops, loops in one arm of a branch (decided or not), loops whose own condition uses the key, labelled break and continue, try | finally, switch, early continue; what was made at the start is used in, between and behind them; in a third of the functions the object is changed in the body (the key deleted, another deleted, one added, the member stored to). Each function runs on a dozen kinds of object. Untyped JavaScript: every line as plain Bun's."""
import random, sys
seed = int(sys.argv[1]); count = int(sys.argv[2]) if len(sys.argv) > 2 else 80
R = random.Random(seed)
print('''const flagTrue = JSON.parse("true"), flagFalse = JSON.parse("false");
const show = v => (typeof v === "number" ? String(v) : typeof v === "string" ? v : typeof v === "object" ? (v === null ? "null" : "obj") : String(v));
const KINDS = [() => ({ a: 5, b: 6 }), () => ({ a: 1, b: 2, c: 3, d: 4 }), () => ({}), () => ({ only: 7 }), () => { const o = { a: 1, b: 2, c: 3 }; delete o.b; return o; }, () => Object.create({ up: 9, a: 8 }, { a: { value: 1, enumerable: true, writable: true, configurable: true } }), () => [10, 20, 30], () => ({ 1: 11, 0: 10, z: 12 }), () => { const o = {}; for (let i = 0; i < 70; i++) o["k" + i] = i; return o; }, () => ({ get a() { return 3; }, b: 4 }), () => Object.assign(Object.create(null), { a: 2, b: 3 }), () => new Proxy({ a: 5, b: 6 }, {}), () => ({ a: "x", b: null, c: undefined, d: 0.5, e: { f: 1 } }), () => "str"];''')
def start(made):
    c = R.choice(['v', 'h', 't', 'i', 'w', 'g', 'n'])
    if c in made: return None
    made.append(c)
    return {'v': 'const v = o[k];', 'h': 'const h = Object.hasOwn(o, k);', 't': 'const t = typeof o[k];', 'i': 'const i0 = k in o;', 'w': 'const w = o[k] + 1;', 'g': 'let g = true;', 'n': 'const n = !o[k];'}[c]
def use(made):
    pool = ['k'] + [{'v': 'v', 'h': 'h', 't': 't', 'i': 'i0', 'w': 'w', 'g': 'g', 'n': 'n'}[m] for m in made] + ['o[k]']
    return 'out += show(%s) + ",";' % R.choice(pool)
uid = [0]
def loop(made, depth):
    uid[0] += 1; j = 'j%d' % uid[0]
    body = ' '.join(stmt(made, depth + 1) for _ in range(R.randrange(1, 3)))
    f = R.randrange(11)
    if f == 0: return 'let %s = 0; while (%s < 3) { %s %s++; }' % (j, j, body, j)
    if f == 1: return 'for (let %s = 0; %s < 2; %s++) { %s }' % (j, j, j, body)
    if f == 2: return 'let %s = 0; do { %s %s++; } while (%s < 2);' % (j, j and body, j, j)
    if f == 3: return 'for (const %s of [1, 2]) { %s }' % (j, body)
    if f == 4: return 'for (const %s in { p: 1, q: 2 }) { %s out += %s; }' % (j, body, j)
    if f == 5: return 'let %s = 0; while (o[k] !== %s && %s < 3) { %s %s++; }' % (j, j, j, body, j)
    if f == 6: return 'let %s = 0; while (k in o && %s < 2) { %s %s++; }' % (j, j, body, j)
    if f == 7: return 'let %s = 0; while (Object.hasOwn(o, k) && %s < 2) { %s %s++; }' % (j, j, body, j)
    if f == 8 and 'g' in made: return 'let %s = 0; while (g) { %s if (++%s > 1) g = false; }' % (j, body, j)
    if f == 9: return 'let %s = 0; L%s: while (true) { %s if (++%s > 2) break L%s; if (%s === 1) continue L%s; %s }' % (j, j, body, j, j, j, j, use(made))
    return 'for (const %s in o) { if (%s === k) { %s } }' % (j, j, use(made))
def stmt(made, depth):
    f = R.randrange(14 if depth < 2 else 6)
    if f < 4: return use(made)
    if f == 4: return 'if (%s) { %s } else { %s }' % (R.choice(['flagTrue', 'flagFalse', 'o[k]', 'true', 'false', 'k === "a"']), use(made), use(made))
    if f == 5: return 'count++;'
    if f < 10: return '{ ' + loop(made, depth) + ' }'
    if f == 10: return 'if (%s) { %s } else { %s }' % (R.choice(['flagTrue', 'flagFalse', 'o[k]', 'true', 'false', 'k !== "b"']), '{ ' + loop(made, depth) + ' }', use(made))
    if f == 11: return 'try { %s } finally { %s }' % ('{ ' + loop(made, depth) + ' }', use(made))
    if f == 12: return 'switch (k) { case "a": { %s } break; case "b": %s default: %s }' % (loop(made, depth), use(made), use(made))
    return 'if (count++ > 400) break;'
for f in range(count):
    made = []
    s = [x for x in (start(made) for _ in range(R.randrange(0, 5))) if x]
    if R.random() < 0.2: s.insert(R.randrange(len(s) + 1), 'if (!Object.hasOwn(o, k)) continue;')
    if R.random() < 0.33: s.insert(R.randrange(len(s) + 1), R.choice(['delete o[k];', 'delete o.b;', 'if (count < 3) o.added = 1;', 'o[k] = 99;', 'if (k === "a") delete o.c;', 'o.b = "changed";']).join(['try { ', ' } catch (e) { out += "!"; }']))
    body = s + [stmt(made, 0) for _ in range(R.randrange(1, 5))]
    print('function f%d(o) { let out = "", count = 0; for (const k in o) { %s } return out + "#" + count; }' % (f, ' '.join(body)))
print('for (const f of [%s]) { let line = f.name + ":"; for (const make of KINDS) { try { line += " " + f(make()); } catch (e) { line += " !" + e.name; } } console.log(line.length > 900 ? line.slice(0, 900) + line.length : line); }' % ', '.join('f%d' % f for f in range(count)))
