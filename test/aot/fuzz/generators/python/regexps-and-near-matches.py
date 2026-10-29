#!/usr/bin/env python3
"""regexps-and-near-matches.py <seed> [<patterns>]: random LITERAL regular expressions out of a grammar (literals of 1 to 20 characters, classes, negated classes, ranges, escapes \\d \\w \\s \\b \\B, dot, alternations, greedy and lazy quantifiers, counted ones, capturing | named | non-capturing groups, back references, ^ $ with and without m, lookahead and lookbehind, flags g i m s u y in every mix) against subjects made to NEARLY match: the pattern's own literals cut short, shifted to every alignment, in the other case, split by a newline, 8-bit and 16-bit (one letter beyond Latin-1 anywhere turns the whole subject), with surrogate pairs, empty, and 300 characters long. Asked by exec (in a loop with lastIndex), test, match, matchAll, replace (with $1 $& $<name> and a function), split, search. Every line as plain Bun's."""
import random, sys, json
seed = int(sys.argv[1]); count = int(sys.argv[2]) if len(sys.argv) > 2 else 60
R = random.Random(seed)
WORDS = ['a', 'b', 'ab', 'abc', 'foo', 'bar', 'function', 'return', 'constructor', 'abcdefgh', 'abcdefghi', 'aaaaaaaa', 'aaaaaaaab', 'hello world', 'import type', 'http://', '0123456789', 'x', 'é', 'né', '日本', 'ABC', 'Foo', 'the quick brown fox', '--', '_', '.', '/*', '*/', '=>']
def esc(s): return ''.join('\\' + c if c in '\\^$.|?*+()[]{}/' else c for c in s)
lits = []
def literal():
    w = R.choice(WORDS); lits.append(w); return esc(w)
def klass():
    body = ''.join(R.choice(['a-z', 'A-Z', '0-9', 'a-f', 'abc', 'xyz', '_', '\\d', '\\w', '\\s', '\\-', '.', 'é', '日', ' ', '\\n', 'a', 'b', '$', '\\]', 'k', 'K', 's', 'ſ']) for _ in range(R.randrange(1, 4)))
    return '[' + R.choice(['', '', '^']) + body + ']'
def atom(depth, groups):
    c = R.randrange(20)
    if c < 7: return literal()
    if c < 10: return klass()
    if c == 10: return R.choice(['\\d', '\\w', '\\s', '\\D', '\\W', '\\S', '.'])
    if c == 11: return R.choice(['\\b', '\\B', '^', '$'])
    if c == 12 and groups[0] > 0: return '\\%d' % R.randrange(1, groups[0] + 1)
    if depth <= 0: return literal()
    if c in (13, 14): groups[0] += 1; return '(' + alt(depth - 1, groups) + ')'
    if c == 15: return '(?:' + alt(depth - 1, groups) + ')'
    if c == 16: groups[0] += 1; groups[1].append('n%d' % groups[0]); return '(?<n%d>' % groups[0] + alt(depth - 1, groups) + ')'
    if c == 17: return R.choice(['(?=', '(?!']) + seq(depth - 1, [groups[0] + 50, []]).replace('\\5', 'x') + ')' if False else R.choice(['(?=', '(?!']) + literal() + ')'
    if c == 18: return R.choice(['(?<=', '(?<!']) + R.choice([literal(), klass()]) + ')'
    return literal()
def quantified(depth, groups):
    a = atom(depth, groups)
    if a in ('\\b', '\\B', '^', '$') or a.startswith('(?=') or a.startswith('(?!') or a.startswith('(?<=') or a.startswith('(?<!'): return a
    if len(a) > 1 and not (a[0] in '([\\' and (a[0] != '\\' or len(a) == 2)): a = '(?:' + a + ')' if R.random() < 0.3 else a; q_ok = a.startswith('(?:')
    else: q_ok = True
    if q_ok and R.random() < 0.35: a += R.choice(['*', '+', '?', '{2}', '{1,3}', '{0,2}', '{2,}']) + R.choice(['', '', '?'])
    return a
def seq(depth, groups): return ''.join(quantified(depth, groups) for _ in range(R.randrange(1, 4)))
def alt(depth, groups): return '|'.join(seq(depth, groups) for _ in range(R.choice([1, 1, 1, 2, 3])))
def subjects(ls):
    out = ['', 'a', 'abc abc', 'The Quick Brown Fox', 'line one\nline two\r\nline three', 'aaaaaaaaaaaaaaaaab', '0123456789abcdef', 'é日本😀x', 'KkſS']
    for w in ls[:6]:
        for pad in (0, 1, 3, 7, 8, 9):
            out.append('.' * pad + w + '!'); out.append('x' * pad + w[:-1] + w)
        out += [w.upper(), w.swapcase() + w, w[:len(w) // 2] + '\n' + w[len(w) // 2:], w + '日' + w, '😀' + w, w * 3, ('-' * 37 + w) * 8]
    R.shuffle(out); return out[:26]
print('const show = v => v === null ? "null" : v === undefined ? "u" : JSON.stringify(v);')
print('const attempt = f => { try { return f(); } catch (e) { return "THROWS " + e.name; } };')
print('function ask(make, subjects) { let log = ""; for (const s of subjects) { const r = make(); log += attempt(() => { let o = ""; const m = r.exec(s); o += m === null ? "n" : m.index + show([...m]) + show(m.groups) + ":" + r.lastIndex; r.lastIndex = 0; o += r.test(s) ? "T" : "F"; r.lastIndex = 1; o += r.test(s) ? "T" : "F"; o += r.lastIndex; r.lastIndex = 0; o += show(s.match(r)); r.lastIndex = 0; o += s.search(r); o += show(s.replace(r, "[$&|$1]")); r.lastIndex = 0; o += show(s.replace(r, (...a) => "<" + a.slice(0, -2).filter(x => typeof x !== "object").join() + ">")); o += show(s.split(r, 6)); if (r.global) { r.lastIndex = 0; let n = 0; for (const x of s.matchAll(r)) { if (n++ > 8) break; o += x.index + show(x[0]); } r.lastIndex = 0; n = 0; let e; while ((e = r.exec(s)) !== null && n++ < 8) { o += "@" + e.index + "," + r.lastIndex; if (e[0] === "") r.lastIndex++; } } return o; }) + "\\n  "; } return log; }')
for p in range(count):
    lits = []; groups = [0, []]
    pattern = alt(2, groups)
    flags = ''.join(f for f in 'gimsuy' if R.random() < (0.3 if f != 'y' else 0.1))
    if 'u' in flags: pattern = pattern.replace('\\-', '-') if False else pattern
    print('console.log(%s + attempt(() => ask(() => /%s/%s, %s)));' % (json.dumps('p%d /%s/%s: ' % (p, pattern, flags)), pattern.replace('\n', '\\n'), flags, json.dumps(subjects(lits), ensure_ascii=False)))
