#!/usr/bin/env python3
"""Compiles a copy of src/js_parser with the rustc command of the DEBUG build of /workspace/wt/parser (build/debug).
usage: [OUT=<dir>] [RELAX=1] [EMIT=metadata] run_debug.py <tag> <root>     (<root>/src/js_parser is the copy)
Nothing is written into the worktree: no incremental directory, no dep-info, the output goes to $OUT/<tag>."""
import json, os, subprocess, sys, glob, time
tag, root = sys.argv[1], os.path.abspath(sys.argv[2])
assert os.path.exists(root + '/src/js_parser/lib.rs'), root
B = os.environ.get('BUILD', '/workspace/wt/parser/build/debug')
manifest = json.load(open(glob.glob(B + '/rust-target/units/bun_js_parser-*.json')[0]))
out = os.environ.get('OUT', '/tmp/a3-seam/out-debug') + '/' + tag
os.makedirs(out, exist_ok=True)
META = os.environ.get('EMIT') == 'metadata'
args = []
a = manifest['args']
i = 0
while i < len(a):
    x = a[i]
    if x.startswith('--emit='): args.append('--emit=metadata' if META else '--emit=metadata,link')
    elif x.startswith('--error-format') or x.startswith('--json='): pass
    elif x == '--out-dir': args += ['--out-dir', out]; i += 1
    elif x == '-Z' and a[i + 1] == 'binary-dep-depinfo': i += 1
    elif x == '-C' and a[i + 1].startswith('incremental='): i += 1
    else: args.append(x)
    i += 1
args += ['--remap-path-prefix', root + '=' + manifest['cwd']]
if os.environ.get('RELAX'): args += ['-A', 'unused_mut', '-A', 'unused_variables', '-A', 'unused_assignments', '-A', 'dead_code']
env = dict(os.environ); env.update(manifest['env'])
lp = manifest.get('libraryPath')
if lp: env[lp['variable']] = ':'.join(lp['prepend'] + [env.get(lp['variable'], '')])
t = time.time()
r = subprocess.run([manifest['rustc']] + args, cwd=root, env=env, capture_output=True, text=True)
open(out + '/rustc.log', 'w').write(r.stdout + r.stderr)
print(tag, 'rc', r.returncode, 'seconds', int(time.time() - t), sorted(os.listdir(out)))
if r.returncode: print((r.stdout + r.stderr)[-6000:])
sys.exit(r.returncode)
