#!/usr/bin/env python3
"""Compiles a copy of src/js_parser with the rustc command of the release build.
usage: [OUT=<scratch dir>] [RELAX=1] [EMIT=asm|rlib] run.py <tag> <root>      (<root>/src/js_parser is the copy)
EMIT=rlib (default): every flag of the release build is kept and the scratch root is remapped to the worktree path, so
the unpatched copy gives a byte-identical libbun_js_parser-*.rlib (ThinLTO bitcode). Feed the rlib to relink.py.
EMIT=asm: assembly of the crate alone, debug info off. That is the code BEFORE the ThinLTO link: the link inlines more
(all pfx_* and sfx_* handlers, the arrow-return-type attempt), so only relink.py shows the code that ships.
Needs a finished `bun run build:release` in /workspace/wt/parser (dependencies are read from build/release/rust-target).
Nothing is written into the worktree. One run is about 30 s of CPU. RELAX=1 allows unused code in the copy."""
import json, os, subprocess, sys, glob, time
tag, root = sys.argv[1], os.path.abspath(sys.argv[2])
assert os.path.exists(root + '/src/js_parser/lib.rs'), root
rel = '/workspace/wt/parser/build/release'
manifest = json.load(open(glob.glob(rel + '/rust-target/units/bun_js_parser-*.json')[0]))
out = os.environ.get('OUT', '/tmp/zcm-td/seam/out') + '/' + tag
ASM = os.environ.get('EMIT', 'rlib') == 'asm'
if ASM: out += '/asm'
os.makedirs(out, exist_ok=True)
args = []
a = manifest['args']
i = 0
while i < len(a):
    x = a[i]
    if x.startswith('--emit='): args.append('--emit=asm' if ASM else '--emit=metadata,link')
    elif x.startswith('--error-format') or x.startswith('--json='): pass
    elif x == '--out-dir': args += ['--out-dir', out]; i += 1
    elif x == '-Z' and a[i + 1] == 'binary-dep-depinfo': i += 1
    elif ASM and x == '-C' and a[i + 1].startswith('debuginfo='): args += ['-C', 'debuginfo=0']; i += 1
    else: args.append(x)
    i += 1
args += ['--remap-path-prefix', root + '=' + manifest['cwd']]
if os.environ.get('RELAX'): args += ['-A', 'unused_mut', '-A', 'unused_variables', '-A', 'unused_assignments', '-A', 'dead_code', '-A', 'unused_parens', '-A', 'unreachable_code', '-A', 'unused_imports', '-A', 'unused_macros', '-A', 'unreachable_patterns']
env = dict(os.environ); env.update(manifest['env'])
lp = manifest.get('libraryPath')
if lp: env[lp['variable']] = ':'.join(lp['prepend'] + [env.get(lp['variable'], '')])
t = time.time()
r = subprocess.run([manifest['rustc']] + args, cwd=root, env=env, capture_output=True, text=True)
open(out + '/rustc.log', 'w').write(r.stdout + r.stderr)
print(tag, 'rc', r.returncode, 'seconds', int(time.time() - t), sorted(os.listdir(out)))
if r.returncode: print((r.stdout + r.stderr)[-6000:])
sys.exit(r.returncode)
