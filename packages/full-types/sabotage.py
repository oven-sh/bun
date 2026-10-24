#!/usr/bin/env python3
"""sabotage.py <node_modules that holds react-reconciler 0.33.0> <out folder>: A SABOTAGE FOR EVERY SAFEGUARD: each gate of check.py is seen RED once, on a copy of the reconciler's text with ONE thing wrong; and the gates beside it are seen to stay green where they cannot see it (that is why there are several). NO PACKAGE CODE IS RUN. check.py's environment.
EXIT 1 IF A SABOTAGE IS NOT FOUND BY THE GATE THAT IS DUE TO FIND IT."""
import os, re, shutil, subprocess, sys
H = os.path.dirname(os.path.abspath(__file__)); N, OUT = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]); P = 'react-reconciler@0.33.0'
if os.path.exists(OUT): sys.exit('sabotage.py: %s stands already: name another folder' % OUT)
S = [  # name · the gate that must go red · gates that must NOT see it · old · new
    ('a literal of the code is changed', 'verify', ['errors', 'splits'], '(update.lane = lane | 536870912)),', '(update.lane = lane | 536870913)),'),
    ('a type that is false of the code', 'errors', ['verify', 'splits'], 'update: RR.ConcurrentUpdate | null, lane: RR.Lane): RR.FiberRoot | null {', 'update: RR.ConcurrentUpdate | null, lane: string): RR.FiberRoot | null {'),
    ('a read of the plain variable behind a store to a role', 'splits', ['verify'], '        parent$asRoot)', '        parent)'),
    ('a read in a loop ahead of the store in the text, written as the arriving value', 'splits', ['verify'], '      var context = currentDependencies$asDependency.context;', '      var context = (currentDependencies as any).context;'),
    ('the result read as the parameter, two roles of one kind of use', 'splits', ['verify'], '        (inst$asQueue.lastEffect = tag$asEffect));\n    return tag$asEffect;', '        (inst$asQueue.lastEffect = tag$asEffect));\n    return tag as never;'),
    ('a role of an outer variable', 'splits', ['verify', 'errors'], '    currentlyRenderingFiber$1 = workInProgress;', '    currentlyRenderingFiber$1$asMine = workInProgress;'),
    ('a cast that only a host that is not strict needs is taken away', 'lax', ['verify', 'errors', 'splits'], '                destroy_ = destroy/*$*/ as RR.EffectDestroy/*$*/;', '                destroy_ = destroy;'),
    ('a role more than the committed count', 'counts', ['verify', 'errors', 'splits'], 'parent$asRoot: RR.FiberRoot, ', 'parent$asRoot: RR.FiberRoot, parent$asNothing: number, '),
]
bad = 0
for i, (name, due, blind, old, new) in enumerate(S, 1):
    D = '%s/s%d' % (OUT, i); os.makedirs(D + '/packages'); f = D + '/packages/' + P + '/typed.cts'
    if os.path.isdir(H + '/packages/' + P): shutil.copytree(H + '/packages/' + P, D + '/packages/' + P)
    else: shutil.copytree(H + '/react-reconciler/0.33.0/src', D + '/packages/' + P)  # in the repository the text lies under <name>/<version>/src
    t = open(f).read()
    if t.count(old) != 1: print('FAIL s%d %s: THE SABOTAGE DID NOT APPLY: the pattern stands %d times' % (i, name, t.count(old))); bad += 1; continue
    open(f, 'w').write(t.replace(old, new))
    r = subprocess.run([sys.executable, H + '/check.py', N, D + '/out', '--only=' + P], env=dict(os.environ, SHIP_PACKAGES=D + '/packages'), capture_output=True, text=True)
    G = {}
    for m in re.finditer(r'^(ok|FAIL) +\S+ +(\w+) ', r.stdout, re.M): G[m.group(2)] = 'FAIL' if 'FAIL' in (m.group(1), G.get(m.group(2))) else 'ok'  # a gate may speak once a file: one FAIL is a FAIL
    found = G.get(due) == 'FAIL'; seen = [g for g in blind if G.get(g) == 'FAIL']
    print('%s s%d %-82s %s: %s%s' % ('ok  ' if found else 'FAIL', i, name, due, 'RED, as due' if found else 'NOT FOUND: THE SAFEGUARD IS BLIND', ' · green beside it: ' + ' '.join(g for g in blind if g not in seen) + (' · ALSO RED: ' + ' '.join(seen) if seen else '')))
    if not found: bad += 1
print('sabotage.py: %s' % ('EVERY ONE FOUND' if not bad else '%d NOT FOUND' % bad)); sys.exit(1 if bad else 0)
