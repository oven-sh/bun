#!/usr/bin/env python3
"""Programs whose functions build strings in many ways: templates, +, +=, loops that run no, one or several times, conditional parts, early
returns, calls in the middle of a concatenation, numbers in several radixes, objects whose toString() and valueOf() are heard, exceptions
in the middle and try blocks. Every result is printed with its length and a hash, and the order of the side effects at the end."""
import random, sys
seed = int(sys.argv[1]); count = int(sys.argv[2]) if len(sys.argv) > 2 else 14
R = random.Random(seed)
TEXTS = ['""', '"a"', '"<b>"', '"</b>"', '" "', '","', '"caf\\u00e9"', '"\\u65e5\\u672c"', '"\\ud83d\\ude00"', '"\\ud83d"', '"&amp;"', '"0123456789abcdef0123456789abcdef"', '"x".repeat(70)', '"\\u2014".repeat(9)', '"q".repeat(300)']
NUMBERS = ['0', '-0', '1', '-1', '7', '10', '255', '65536', '2147483647', '-2147483648', '4294967296', '0.5', '-1.25', '1e21', '1e-7', 'NaN', 'Infinity', '-Infinity', '123456789.5']
out = []
emit = out.append


def text(depth, me, names):
    """An expression of type string."""
    k = R.random()
    if depth <= 0 or k < 0.18:
        return R.choice(TEXTS + names['s'] * 3) if names['s'] else R.choice(TEXTS)
    if k < 0.42:
        parts = []
        for _ in range(R.randint(1, 5)):
            parts.append(R.choice(['<i>', '</i>', ' ', '-', 'k=', '"', "'", '\\n', '\\u00e9', '\\u65e5', '']))
            parts.append('${%s}' % hole(depth - 1, me, names))
        return '`' + ''.join(parts) + R.choice(['', '.', '</p>']) + '`'
    if k < 0.58:
        first = text(depth - 1, me, names)
        return '(' + ' + '.join([first] + [hole(depth - 1, me, names) for _ in range(R.randint(1, 3))]) + ')'
    if k < 0.80 and me > 0:
        return call(depth, me, names)
    if k < 0.88:
        return '(%s ? %s : %s)' % (condition(names), text(depth - 1, me, names), text(depth - 1, me, names))
    if k < 0.93 and names['a']:
        callee = R.randrange(me) if me > 0 else None
        body = 'f%d(e, n, d - 1)' % callee if callee is not None and R.random() < 0.6 else '`[${e}]`'
        return '%s.map(e => %s).join(%s)' % (R.choice(names['a']), body, R.choice(['""', '","', '"\\n"']))
    if k < 0.97:
        return 'noisy(%s)' % text(depth - 1, me, names)
    return R.choice(['String(%s)', '(%s).toString()', '(%s).toString(2)', '(%s).toString(16)', '(%s).toString(36)']) % number(names)


def call(depth, me, names):
    callee = R.randrange(me + 1) if R.random() < 0.15 else R.randrange(me)
    return 'f%d(%s, %s, d - 1)' % (callee, text(depth - 2, me, names), number(names))


def number(names):
    return R.choice(NUMBERS + names['n'] * 4 + ['(n + 1)', '(n * 3)', '(n / 2)', 's.length'])


def hole(depth, me, names):
    k = R.random()
    if k < 0.55:
        return text(depth, me, names)
    if k < 0.8:
        return number(names)
    if k < 0.87:
        return R.choice(['maybe(n)', 'nothing(n)', '(n > 2)', 'null', 'undefined'])
    if k < 0.93:
        return 'loose(%s)' % R.choice(['n', 's', '"t"', '3'])
    return 'talker(%s)' % text(0, me, names)


def condition(names):
    return R.choice(['n > 3', 'n % 2 === 0', 's.length > 4', 's.length === 0', 'd > 1', 'n < 0', 'tick() % 3 === 0'])


def statements(depth, me, names, indent, in_loop):
    pad = '  ' * indent
    for _ in range(R.randint(1, 4)):
        k = R.random()
        if k < 0.3:
            emit('%sr += %s;' % (pad, text(depth, me, names)))
        elif k < 0.4:
            emit('%sr = r + %s + %s;' % (pad, hole(depth, me, names), hole(depth - 1, me, names)))
        elif k < 0.5 and depth > 0:
            name = 't%d' % len(names['s'])
            emit('%sconst %s = %s;' % (pad, name, text(depth, me, names)))
            names = dict(names, s=names['s'] + [name])
        elif k < 0.62 and depth > 0:
            emit('%sif (%s) {' % (pad, condition(names)))
            statements(depth - 1, me, names, indent + 1, in_loop)
            if R.random() < 0.5:
                emit('%s} else {' % pad)
                statements(depth - 1, me, names, indent + 1, in_loop)
            emit('%s}' % pad)
        elif k < 0.74 and depth > 0 and indent < 4:
            v = 'i%d' % indent
            emit('%sfor (let %s = 0; %s < %s; %s++) {' % (pad, v, v, R.choice(['1', '(n & 1)', '2', '3', '(n & 3)', '5']), v))
            statements(depth - 1, me, dict(names, n=names['n'] + [v]), indent + 1, True)
            emit('%s}' % pad)
        elif k < 0.79 and names['a'] and depth > 0 and indent < 4:
            v = 'e%d' % indent
            emit('%sfor (const %s of %s) {' % (pad, v, R.choice(names['a'])))
            statements(depth - 1, me, dict(names, s=names['s'] + [v]), indent + 1, True)
            emit('%s}' % pad)
        elif k < 0.84:
            emit('%sif (%s) return %s;' % (pad, condition(names), R.choice(['r', text(depth, me, names), 'r + ' + text(depth - 1, me, names)])))
        elif k < 0.88:
            emit('%sif (tick() %% %d === 0) throw new Failure(%s);' % (pad, R.choice([5, 7, 11, 13]), text(0, me, names)))
        elif k < 0.92 and in_loop:
            emit('%sif (%s) %s;' % (pad, condition(names), R.choice(['break', 'continue'])))
        elif k < 0.96 and depth > 0:
            emit('%stry {' % pad)
            statements(depth - 1, me, names, indent + 1, in_loop)
            emit('%s} catch (error) {' % pad)
            emit('%s  r += `!${(error as Error).message}`;' % pad)
            emit('%s}' % pad)
        else:
            emit('%slog.push(%s);' % (pad, R.choice(['r', 's', text(0, me, names)])))
    return names


emit('// Generated: seed %d.' % seed)
emit('''const log: string[] = [];
let ticks = 0;
function tick(): number { return ++ticks; }
class Failure extends Error {}
function noisy(text: string): string { log.push("noisy " + text.length); return text; }
function maybe(n: number): string | undefined { return n % 2 ? "odd" : undefined; }
function nothing(n: number): string | null { return n % 3 ? null : "third"; }
function loose(value: unknown): any { return value; }
function talker(text: string): any { return { toString() { log.push("toString " + text.length); return text; }, valueOf() { log.push("valueOf " + text.length); return text + "!"; } }; }
const lists: string[][] = [[], ["a"], ["b", "\\u65e5", ""], ["c", "d", "e", "f"]];
function show(label: string, text: string): void {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  console.log(label, text.length, hash, JSON.stringify(text.length <= 60 ? text : text.slice(0, 28) + ".." + text.slice(-28)));
}''')
for me in range(count):
    emit('function f%d(s: string, n: number, d: number): string {' % me)
    emit('  if (d <= 0) return %s;' % R.choice(['s', '""', '`(${s})`', '"." + n']))
    emit('  const list = lists[(n >>> 0) % lists.length]!;')
    names = {'s': ['s'], 'n': ['n'], 'a': ['list']}
    shape = R.random()
    if shape < 0.35:
        emit('  return %s;' % text(3, me, names))
    else:
        emit('  let r = %s;' % R.choice(['""', '""', 's', '"<r>"']))
        names = statements(3, me, names, 1, False)
        emit('  return %s;' % R.choice(['r', 'r', 'r + %s' % text(1, me, names), '`<w>${r}</w>`', '`${%s}${r}`' % text(1, me, names)]))
    emit('}')
emit('const inputs = ["", "z", "caf\\u00e9", "\\u65e5\\u672c\\u8a9e", "w".repeat(33)];')
emit('for (let round = 0; round < 3; round++) {')
emit('  for (const [k, f] of [%s].entries()) {' % ', '.join('f%d' % i for i in range(count)))
emit('    for (let n = -1; n < 6; n++) {')
emit('      const s = inputs[(n + round + 5) % inputs.length]!;')
emit('      try {')
emit('        show(`f${k} ${n}`, f(s, n, 3));')
emit('      } catch (error) {')
emit('        show(`f${k} ${n} threw`, (error as Error).message);')
emit('      }')
emit('    }')
emit('  }')
emit('}')
emit('show("log", log.join("|"));')
print('\n'.join(out))
