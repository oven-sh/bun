#!/usr/bin/env python3
"""Links bun-debug as the release build does, with the bun_js_parser rlib replaced by another one.
usage: link.py <tag> [<rlib>]     -> /tmp/eit/link-debug/<tag>/bun-debug   (no rlib: the one of the worktree build)
The inputs and flags are read from /workspace/wt/parser/build/release/build.ninja (edge `bun-debug`, rule `link`).
Every relative input path is made absolute, the output and the linker map go to /tmp: nothing is written into the worktree.
Every other input (C++ objects, the other 173 rlibs) is the one of the worktree's release build of e3566be889."""
import os, re, subprocess, sys, time
tag = sys.argv[1]; rlib = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else None
R = '/workspace/wt/parser/build/debug'
s = open(R + '/build.ninja').read()
i = s.index('\nbuild bun-debug | '); j = s.index('\n\n', i + 1)
edge = s[i + 1:j].replace('$\n', '')
lines = edge.split('\n')
m = re.match(r'build (.*?): link (.*)$', lines[0])
explicit = m.group(2).split(' || ')[0].split(' | ')[0].split()
var = {}
for l in lines[1:]:
    k, v = l.strip().split(' = ', 1); var[k] = v
rule = s[s.index('\nrule link\n'):]; cmd = re.search(r'command = (.*)', rule).group(1)
assert cmd == '/usr/lib/llvm-23/bin/clang++ @$out.rsp $lazy $ldflags -o $out', cmd
out = '/tmp/eit/link-debug/' + tag; os.makedirs(out, exist_ok=True)
def ab(p): return p if p.startswith(('/', '-')) else os.path.normpath(os.path.join(R, p))
ins = [ab(p) for p in explicit]
js = [p for p in ins if re.search(r'/libbun_js_parser-[0-9a-f]+\.rlib$', p)]
assert len(js) == 1, js
if rlib: ins = [rlib if p == js[0] else p for p in ins]
open(out + '/bun-debug.rsp', 'w').write('\n'.join(ins) + '\n')
assert var['lazy'] == '-Wl,@bun-debug.lazy.rsp', var['lazy']
lazy = [ab(l) for l in open(R + '/bun-debug.lazy.rsp').read().split('\n') if l]
open(out + '/bun-debug.lazy.rsp', 'w').write('\n'.join(lazy) + '\n')
ld = var['ldflags'].split()
ld = [f for f in ld if f not in ('-Wl,--gdb-index', '-Wl,--compress-debug-sections=zlib')] + ['-Wl,--strip-debug']
for f in ld: assert '/workspace/wt/parser/build/release/bun-debug' not in f, f
argv = ['/usr/lib/llvm-23/bin/clang++', '@' + out + '/bun-debug.rsp', '-Wl,@' + out + '/bun-debug.lazy.rsp'] + ld + ['-o', out + '/bun-debug']
open(out + '/link.cmd', 'w').write(' '.join(argv) + '\n')
t = time.time()
r = subprocess.run(argv, cwd=out, capture_output=True, text=True)
open(out + '/link.log', 'w').write(r.stdout + r.stderr)
print(tag, 'rc', r.returncode, 'seconds', int(time.time() - t), (r.stdout + r.stderr)[-600:])
sys.exit(r.returncode)
