#!/usr/bin/env python3
"""tail-calls-permuting-arguments.py <seed>: tail calls whose arguments are the caller's own incoming arguments in another order (a parallel move over the very slots that are overwritten), more than the caller got, fewer, of mixed kinds (objects, strings, doubles, int32s, booleans, nil, arrays, closures), made in the caller just before it goes; the callee makes garbage before it looks at them. Chains (few -> many -> many), self loops that rotate their arguments, pairs that rotate them."""
import random, sys
random.seed(int(sys.argv[1]) if len(sys.argv) > 1 else 20261015)
import os
KINDS = ['Rec', 'string', 'number', 'number', 'boolean', 'Rec | null', 'number[]', '() => number']
if os.environ.get('NO_BOOLEAN'): KINDS.remove('boolean')
def show(kind, name):
    return {'Rec': '%s.name + %s.n', 'string': '%s + %s.length', 'number': '%s + "/" + (%s * 2)', 'boolean': '%s + "" + !%s', 'Rec | null': '(%s ? %s.name : "nil")', 'number[]': '%s.join("+") + %s.length', '() => number': '%s() + "" + typeof %s'}[kind] % (name, name)
def make(kind, k):
    return {'Rec': 'rec("r%d")' % k, 'string': '"s" + k + %d' % k, 'number': ['k + %d.5' % k, 'k * %d' % (k + 1)][k % 2], 'boolean': 'k %% %d === 0' % (k % 3 + 2), 'Rec | null': ['null', 'rec("m%d")' % k][k % 2], 'number[]': '[k, %d, k + 0.5]' % k, '() => number': '() => k + %d' % k}[kind]
out = ['''declare const console: { log(...values: unknown[]): void };
class Rec { constructor(public name: string, public n: number) {} }
let made = 0;
function rec(name: string): Rec { return new Rec(name, ++made); }
let sink: unknown[] = [];
function churn(): void { sink = []; for (let i = 0; i < 30; i++) sink.push({ i, s: "g" + i, a: [i, i + 0.5], r: new Rec("x", i) }); sink = []; }
let digest = 0;
function note(text: string): void { for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) % 1000000007; }
''']
calls = []
for row in range(36):
    n = random.choice([2, 5, 6, 7, 8, 9, 10, 12, 14, 16, 20, 24])
    kinds = [random.choice(KINDS) for _ in range(n)]
    names = ['a%d' % i for i in range(n)]
    typed = ', '.join('%s: %s' % p for p in zip(names, kinds))
    out.append('function last%d(%s): string { churn(); return [%s].join(","); }\n' % (row, typed, ', '.join(show(k, a) for a, k in zip(names, kinds))))
    perm = list(range(n)); random.shuffle(perm)
    mid_names = ['b%d' % i for i in range(n)]
    back = [None] * n
    for at, p in enumerate(perm): back[p] = mid_names[at]
    out.append('function middle%d(%s): string { churn(); return last%d(%s); }\n' % (row, ', '.join('%s: %s' % (m, kinds[p]) for m, p in zip(mid_names, perm)), row, ', '.join(back)))
    few = random.choice([0, 1, 2, 3])
    first_params = ['k: number'] + ['c%d: %s' % (i, kinds[p]) for i, p in enumerate(perm[:few])]
    args = ['c%d' % i if i < few else make(kinds[p], i) for i, p in enumerate(perm)]
    out.append('function first%d(%s): string { return middle%d(%s); }\n' % (row, ', '.join(first_params), row, ', '.join(args)))
    calls.append('first%d(k%s)' % (row, ''.join(', ' + make(kinds[p], 90 + i) for i, p in enumerate(perm[:few]))))
    bykind = {}
    for i, k in enumerate(kinds): bykind.setdefault(k, []).append(i)
    rotated = list(names)
    for k, places in bykind.items():
        for j, place in enumerate(places): rotated[place] = names[places[(j + 1) % len(places)]]
    out.append('function round%d(turns: number, %s): string { if (turns === 0) return last%d(%s); if (turns %% 7 === 0) churn(); return round%d(turns - 1, %s); }\n' % (row, typed, row, ', '.join(names), row, ', '.join(rotated)))
    out.append('function other%d(turns: number, %s): string { return turns === 0 ? last%d(%s) : pair%d(turns - 1, %s); }\n' % (row, typed, row, ', '.join(names), row, ', '.join(rotated)))
    out.append('function pair%d(turns: number, %s): string { if (turns %% 5 === 0) churn(); return other%d(turns, %s); }\n' % (row, typed, row, ', '.join(rotated)))
    fresh = ', '.join(make(k, 40 + i) for i, k in enumerate(kinds))
    calls.append('round%d(k * 3 + 1, %s)' % (row, fresh))
    calls.append('pair%d(k * 2 + 1, %s)' % (row, fresh))
out.append('for (let k = 0; k < 5; k++) {\n')
for at, call in enumerate(calls):
    out.append('  note(%s);\n' % call)
    if at % 27 == 26: out.append('  console.log(k, %d, digest);\n' % at)
out.append('}\n{ const k = 2; console.log(%s); console.log(%s); console.log(%s); }\nconsole.log("digest", digest);\n' % (calls[0], calls[4], calls[8]))
print(''.join(out), end='')
