#!/usr/bin/env python3
"""Links bun-debug again from the finished debug build of /workspace/wt/parser with the rlib of bun_js_parser replaced.
usage: relink_debug.py <tag> <replacement libbun_js_parser-*.rlib>      (run it through /workspace/tools/lk)
The link command, its inputs and flags are read from build/debug/build.ninja. Output: $OUT/<tag>/bun-debug (default
/tmp/a3-seam/link-debug). Nothing is written into the worktree."""
import os, re, subprocess, sys, time
R = os.environ.get('BUILD', '/workspace/wt/parser/build/debug')
OUT = os.environ.get('OUT', '/tmp/a3-seam/link-debug')
tag, repl = sys.argv[1], os.path.abspath(sys.argv[2])
assert os.path.exists(repl), repl
out = OUT + '/' + tag
os.makedirs(out, exist_ok=True)
text = open(R + '/build.ninja').read().replace('$\n', '')
lines = text.split('\n')
edge = next(i for i, l in enumerate(lines) if l.startswith('build bun-debug |') and ': link ' in l)
explicit = lines[edge].split(': link ', 1)[1].split(' | ')[0].split()
ldflags = next(l[len('  ldflags = '):] for l in lines[edge + 1:edge + 12] if l.startswith('  ldflags = '))
n = 0
for i, x in enumerate(explicit):
    if re.search(r'/libbun_js_parser-[0-9a-f]+\.rlib$', x):
        explicit[i] = repl; n += 1
assert n == 1, n
open(out + '/bun-debug.rsp', 'w').write('\n'.join(explicit) + '\n')
cmd = '/usr/lib/llvm-23/bin/clang++ @%s/bun-debug.rsp -Wl,@bun-debug.lazy.rsp %s -o %s/bun-debug' % (out, ldflags, out)
open(out + '/link.cmd', 'w').write(cmd + '\n')
t = time.time()
r = subprocess.run(cmd, shell=True, cwd=R, capture_output=True, text=True)
open(out + '/link.log', 'w').write(r.stdout + r.stderr)
print(tag, 'rc', r.returncode, 'seconds', int(time.time() - t), 'load', open('/proc/loadavg').read().split()[0], flush=True)
if r.returncode: print((r.stdout + r.stderr)[-3000:], flush=True)
sys.exit(r.returncode)
