import json, os, subprocess, sys
mode = sys.argv[1]  # rustc | clippy
profile = sys.argv[2] if len(sys.argv) > 2 else 'debug'
import glob
unit = glob.glob(f'/workspace/wt/parser/build/{profile}/rust-target/units/bun_ast-*.json')
unit = [u for u in unit if 'jsc' not in u][0]
u = json.load(open(unit))
args = list(u['args'])
out = []
i = 0
while i < len(args):
    a = args[i]
    if a == 'src/ast/lib.rs':
        out.append('/tmp/tsnodes/ast/lib.rs')
    elif a.startswith('--emit='):
        out.append('--emit=metadata')
    elif a == '--out-dir':
        out += ['--out-dir', f'/tmp/tsnodes/out-{profile}-{mode}']
        i += 1
    elif a == '-C' and args[i+1].startswith('incremental='):
        i += 1
    elif a.startswith('--error-format=') or a.startswith('--json='):
        pass
    elif a == '-Z' and args[i+1] == 'binary-dep-depinfo':
        i += 1
    else:
        out.append(a)
    i += 1
out += sys.argv[3:]
os.makedirs(f'/tmp/tsnodes/out-{profile}-{mode}', exist_ok=True)
env = dict(os.environ)
env.update(u['env'])
prog = u['rustc']
if mode == 'clippy':
    prog = os.path.join(os.path.dirname(prog), 'clippy-driver')
print('RUN', prog, len(out), 'args', flush=True)
r = subprocess.run([prog] + out, cwd=u['cwd'], env=env)
print('EXIT', r.returncode)
sys.exit(r.returncode)
