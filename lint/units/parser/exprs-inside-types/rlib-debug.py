#!/usr/bin/env python3
"""Compiles a copy of src/js_parser to the rlib that the release build links (LLVM bitcode, same rustc command).
usage: rlib.py <tag> <directory of a copy of src/js_parser>   -> /tmp/eit/rlib-debug/<tag>/libbun_js_parser-8337f9633b1f3cf3.rlib
The command is the one of build/release/rust-target/units/bun_js_parser-*.json with the source, the output directory and
the dep-info path replaced, and --remap-path-prefix so that file!() strings are the ones of the worktree build.
Nothing is written into the worktree."""
import json, os, subprocess, sys, glob, time
tag, src = sys.argv[1], os.path.abspath(sys.argv[2])
root = '/workspace/wt/parser/build/debug'
manifest = json.load(open(glob.glob(root + '/rust-target/units/bun_js_parser-8337*.json')[0]))
out = '/tmp/eit/rlib-debug/' + tag
os.makedirs(out, exist_ok=True)
args = []; a = manifest['args']; i = 0
while i < len(a):
    x = a[i]
    if x == 'src/js_parser/lib.rs': args.append(src + '/lib.rs')
    elif x.startswith('--emit='): args.append('--emit=dep-info=%s/bun_js_parser.d,metadata,link' % out)
    elif x.startswith('--error-format') or x.startswith('--json='): pass
    elif x == '--out-dir': args += ['--out-dir', out]; i += 1
    elif x == '-Z' and a[i + 1] == 'binary-dep-depinfo': i += 1
    else: args.append(x)
    i += 1
args += ['--remap-path-prefix', src + '=src/js_parser']
args += ['-A', 'unused_mut', '-A', 'unused_variables', '-A', 'unused_assignments', '-A', 'dead_code']
env = dict(os.environ); env.update(manifest['env'])
lp = manifest.get('libraryPath')
if lp: env[lp['variable']] = ':'.join(lp['prepend'] + [env.get(lp['variable'], '')])
t = time.time()
r = subprocess.run([manifest['rustc']] + args, cwd=manifest['cwd'], env=env, capture_output=True, text=True)
open(out + '/rustc.log', 'w').write(r.stdout + r.stderr)
print(tag, 'rc', r.returncode, 'seconds', int(time.time() - t), os.listdir(out))
sys.exit(r.returncode)
