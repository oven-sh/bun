#!/usr/bin/env python3
"""piecework.py split | take NN | assemble | errors [NN [max]] | bang [NN] | verify | stats

Typing one published file in place, in pieces. Run it inside a project folder that holds
  original.js    the package's file, untouched
  project.json   { "module": "esm" | "cjs", "shapes": "sv", "space": "SV" }
  <shapes>-shapes*.d.ts   declare namespace <SPACE> { .. }: the shared declarations
  parts/NN.mts | NN.cts   the pieces that have been taken; a piece nobody took is the original's lines

split      the pieces: about 480 lines each, cut at top-level declarations
take NN    creates parts/NN from the original's lines and prints its path: that file is what you edit
errors NN  assembles typed.mts | typed.cts, type-checks it, prints the errors in piece NN (line numbers within the piece)
errors     the total and the count by piece
bang NN    puts `!` wherever the checker says "possibly null | undefined"
verify     strips what was added (markers, $given, $as<Role>, the types) and compares with original.js, both printed by Bun: must say PASS
stats      how many `any` and casts the text has
Environment: SEMA (the checker's CLI), BUN, BUN_SEMA_TS_LIB."""
import json, os, re, shutil, subprocess, sys, tempfile
W = os.getcwd(); O = W + '/original.js'; P = W + '/parts'
if not os.path.exists(W + '/project.json') or not os.path.exists(O): sys.exit(__doc__)
C = json.load(open(W + '/project.json')); JS, TS = ('mjs', 'mts') if C['module'] == 'esm' else ('cjs', 'cts'); SHAPES = C['shapes'] + '-shapes'; TYPED = 'typed.' + TS
SEMA = os.environ.get('SEMA') or sys.exit('piecework: SEMA=<the checker\'s CLI> is wanted'); BUN = os.environ.get('BUN', 'bun'); ENV = dict(os.environ, NO_COLOR='1')
plain = lambda s: re.sub(r'\x1b\[[0-9;]*m', '', s)
def ranges():
    L = open(O).read().split('\n'); starts = [i for i, l in enumerate(L) if l.startswith(('function ', 'async function ', 'var ', 'let ', 'const ', 'class ', 'exports.', 'export ', '//#region '))]; cuts = [0]
    for s in starts:
        if s - cuts[-1] >= 480: cuts.append(s)
    cuts.append(len(L)); return L, [(cuts[i], cuts[i + 1]) for i in range(len(cuts) - 1)]
name = lambda i: '%s/%02d.%s' % (P, i, TS)
def part(i, L, r): return open(name(i)).read().rstrip('\n').split('\n') if os.path.exists(name(i)) else L[r[0]:r[1]]
def assemble():
    L, R = ranges(); out = ['/// <reference path="./%s" />' % f for f in sorted(x for x in os.listdir(W) if x.startswith(SHAPES) and x.endswith('.d.ts'))]; where = []
    for i, r in enumerate(R): x = part(i, L, r); where.append((len(out) + 1, len(out) + len(x))); out += x
    open(W + '/' + TYPED, 'w').write('\n'.join(out)); return where
def check(): r = subprocess.run([SEMA, 'cli', TYPED, '--noEmit', '--all', '--strict'], cwd=W, env=ENV, capture_output=True, text=True); return plain(r.stdout + r.stderr)
def strip(t): t = re.sub(r'/\*\$\*/.*?/\*\$\*/', '', t, flags=re.S); t = re.sub(r'\b([A-Za-z_$][\w$]*?)\$given\b', r'\1', t); return re.sub(r'\b([A-Za-z_$][\w$]*?)\$as[A-Z]\w*\b', r'\1', t)
cmd = sys.argv[1] if len(sys.argv) > 1 else ''; AT = re.escape(TYPED)
if cmd == 'split':
    for i, r in enumerate(ranges()[1]): print('%02d lines %d..%d (%d)' % (i, r[0] + 1, r[1], r[1] - r[0]))
elif cmd == 'take':
    L, R = ranges(); i = int(sys.argv[2]); os.makedirs(P, exist_ok=True)
    if not os.path.exists(name(i)): open(name(i), 'w').write('\n'.join(L[R[i][0]:R[i][1]]) + '\n')
    print(name(i))
elif cmd == 'assemble': print(assemble())
elif cmd == 'errors':
    where = assemble(); t = check(); E = [(int(m.group(3)), m.group(1), ' '.join(m.group(2).split())) for m in re.finditer(r'error: (TS\d+): (.*?)\n\s+at ' + AT + r':(\d+)', t, re.S)]
    if len(sys.argv) > 2:
        i = int(sys.argv[2]); a, b = where[i]; mine = sorted(e for e in E if a <= e[0] <= b); print('piece %02d is lines %d..%d of %s; %d errors in it (line numbers are within the piece)' % (i, a, b, TYPED, len(mine)))
        for l, c, s in mine[:int(sys.argv[3]) if len(sys.argv) > 3 else 80]: print('%5d %s %s' % (l - a + 1, c, s[:170]))
    else:
        print('total: %d · by piece: %s' % (len(E), ' '.join('%02d:%d' % (i, sum(a <= e[0] <= b for e in E)) for i, (a, b) in enumerate(where))))
        if not E and 'No type errors' not in t: print(t[-600:])
elif cmd == 'bang':
    only = int(sys.argv[2]) if len(sys.argv) > 2 else None; put = 0
    for turn in range(15):
        where = assemble(); t = check(); todo = {}
        for m in re.finditer(r"error: TS(?:18047|18048|18049): '(.+?)' is possibly .*?\n\s+at " + AT + r':(\d+):(\d+)', t, re.S):
            e, l, c = m.group(1), int(m.group(2)), int(m.group(3))
            for i, (a, b) in enumerate(where):
                if a <= l <= b and only in (None, i) and os.path.exists(name(i)): todo.setdefault(i, set()).add((l - a, c - 1, e))
        n = 0
        for i, S in todo.items():
            X = open(name(i)).read().rstrip('\n').split('\n')
            for l, c, e in sorted(S, reverse=True):
                if l < len(X) and X[l][c:c + len(e)] == e and X[l][c + len(e):c + len(e) + 1] != '!': X[l] = X[l][:c + len(e)] + '!' + X[l][c + len(e):]; n += 1
            open(name(i), 'w').write('\n'.join(X) + '\n')
        put += n
        if not n: break
    print('bang: %d ! put' % put)
elif cmd == 'verify':
    assemble(); d = tempfile.mkdtemp(dir=W); shutil.copy(O, d + '/a.' + JS); open(d + '/b.' + TS, 'w').write(strip(open(W + '/' + TYPED).read()))
    o = [subprocess.run([BUN, 'build', '--no-bundle', '--target=bun', f], cwd=d, capture_output=True, text=True) for f in ('a.' + JS, 'b.' + TS)]; shutil.rmtree(d)
    a, b = [[l for l in x.stdout.split('\n') if l.strip()] for x in o]
    if o[1].returncode or not b: print('VERIFY: the typed text does not parse:', o[1].stderr[:600]); sys.exit(1)
    if a == b: print('VERIFY: PASS: with the types stripped the text is the original (%d printed lines)' % len(a))
    else: n = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), min(len(a), len(b))); print('VERIFY: FAIL at printed line %d:\n  original: %s\n  typed   : %s' % (n + 1, a[n][:200] if n < len(a) else '-', b[n][:200] if n < len(b) else '-')); sys.exit(1)
elif cmd == 'stats':
    assemble(); t = open(W + '/' + TYPED).read(); print('as any: %d · : any: %d · as unknown as: %d · other casts: %d · !: %d' % (len(re.findall(r'\bas any\b', t)), len(re.findall(r':\s*any\b', t)), len(re.findall(r'as unknown as', t)), len(re.findall(r'\bas (?!any\b|unknown\b)[A-Z]', t)), len(re.findall(r'[\w)\]]!(?=[.\[(,;) ])', t))))
else: sys.exit(__doc__)
