# Builds a metadata-only rustc command from the unit of bun_lint in the build plan: same flags, another crate root, output in /tmp.
import json, sys, glob, os
unit = json.load(open('/workspace/wt/cli/build/debug/rust-target/units/bun_lint-7d2963c0eb66e736.json'))
root, outdir = sys.argv[1], sys.argv[2]
externs = sys.argv[3:]
deps = '/workspace/wt/cli/build/debug/rust-target/x86_64-unknown-linux-gnu/deps'
args = []
it = iter(unit['args'])
for a in it:
    if a == 'src/lint/lib.rs':
        args.append(root); continue
    if a.startswith('--emit='):
        args.append('--emit=metadata'); continue
    if a == '--out-dir':
        next(it); args += ['--out-dir', outdir]; continue
    if a == '-C':
        b = next(it)
        if b.startswith('incremental=') or b.startswith('extra-filename=') or b.startswith('metadata='):
            continue
        args += ['-C', b]; continue
    if a.startswith('--error-format') or a.startswith('--json'):
        continue
    if a == '-Z':
        b = next(it)
        if b == 'binary-dep-depinfo':
            continue
        args += ['-Z', b]; continue
    args.append(a)
for name in externs:
    cands = sorted(glob.glob('%s/lib%s-*.rmeta' % (deps, name)), key=os.path.getmtime)
    if not cands:
        raise SystemExit('no rmeta for ' + name)
    args += ['--extern', '%s=%s' % (name, cands[-1])]
env = unit.get('env', {})
with open(os.environ.get('CMD_OUT', 'cmd.sh'), 'w') as f:
    f.write('#!/bin/sh\ncd %s\n' % unit['cwd'])
    for k, v in env.items():
        f.write('export %s=%s\n' % (k, json.dumps(v)))
    f.write(unit['rustc'] + ' ' + ' '.join("'%s'" % a.replace("'", "'\\''") for a in args) + '\n')
print('externs:', [a for a in args if '=' in a and 'rmeta' in a and 'noprelude' not in a])
