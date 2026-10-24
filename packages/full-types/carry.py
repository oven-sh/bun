#!/usr/bin/env python3
"""carry.py <package folder under packages/> <npm's file the text was typed on> <ANOTHER file: a new version, a patched copy, a sibling bundle> <out folder>: WHEN npm SHIPS ANOTHER TEXT: the types are carried over BY LINE and the three gates say what is left to do by hand. NO PACKAGE CODE IS RUN. check.py's environment.
THE REHEARSAL: react-dom's legacy server bundle from the Bun bundle's text: 6,245 of 6,978 lines kept their types; 96 errors; AND 14 READS IN 3 FUNCTIONS WHERE THE CARRYING OVER BROKE A ROLE SPLIT (a kept line stores `x$asRole`, the changed line behind it reads the plain `x`): at two of the three the type checker said nothing and verify passed: splits IS THE GATE THAT SEES IT. Mended by 40 exact patterns in minutes.
LEAVES: <out>/typed.cts (edit THAT), the shapes beside it. Run it again with --again to read the gates on the edited text."""
import os, re, shutil, subprocess, sys
H = os.path.dirname(os.path.abspath(__file__)); T = H + '/tools'; a = [x for x in sys.argv[1:] if not x.startswith('--')]
if len(a) < 4: sys.exit(__doc__)
P, OLD, NEW, OUT = (a[0] if os.path.isdir(a[0]) else H + '/packages/' + a[0]), os.path.abspath(a[1]), os.path.abspath(a[2]), os.path.abspath(a[3]); SEMA = os.environ['SEMA']; BUN = os.environ.get('BUN', 'bun'); ENV = dict(os.environ, NO_COLOR='1')
plain = lambda s: re.sub(r'\x1b\[[0-9;]*m', '', s)
if '--again' not in sys.argv:
    if os.path.exists(OUT): sys.exit('carry.py: %s stands already (--again reads the gates on it)' % OUT)
    os.makedirs(OUT); [shutil.copy(P + '/' + f, OUT) for f in os.listdir(P) if f.endswith('.d.ts')]
    r = subprocess.run([sys.executable, '-I', T + '/carry_over.py', P + '/typed.cts', OLD, NEW, OUT + '/typed.cts'], capture_output=True, text=True); print('carried: ' + (r.stdout + r.stderr).strip()[:600])
    if r.returncode: sys.exit(1)
r = subprocess.run([SEMA, 'cli', 'typed.cts', '--noEmit', '--all'], cwd=OUT, env=ENV, capture_output=True, text=True); t = plain(r.stdout + r.stderr); E = re.findall(r'^error: (TS\d+):.*?\n\s+at typed\.cts:(\d+)', t, re.S | re.M)
print('errors : %s%s' % ('none' if 'No type errors' in t else (re.search(r'Found [\d,]+ errors?', t) or ['NO VERDICT'])[0], ' · at lines: ' + ' '.join(sorted({l for _, l in E}, key=int))[:400] if E else ''))
strip = lambda x: re.sub(r'\b([A-Za-z_$][\w$]*?)\$as[A-Z]\w*\b', r'\1', re.sub(r'\b([A-Za-z_$][\w$]*?)\$given\b', r'\1', re.sub(r'/\*\$\*/.*?/\*\$\*/', '', x, flags=re.S)))
V = OUT + '/verify.work'; os.makedirs(V, exist_ok=True); shutil.copy(NEW, V + '/a.cjs'); open(V + '/b.cts', 'w').write(strip(open(OUT + '/typed.cts').read()))
pr = lambda f: [l for l in subprocess.run([BUN, 'build', '--no-bundle', '--target=bun', f], cwd=V, capture_output=True, text=True).stdout.split('\n') if l.strip()]; x, y = pr('a.cjs'), pr('b.cts')
print('verify : %s' % ('the typed text is the other file\'s program (%d printed lines)' % len(x) if y and x == y else 'DIFFERS'))
r = subprocess.run([sys.executable, '-I', T + '/splits1.py', OUT + '/typed.cts', OUT + '/splits.work', SEMA], env=ENV, capture_output=True, text=True); print('splits : ' + '\n         '.join(l.strip()[:200] for l in r.stdout.strip().split('\n')[:24]))
