#!/usr/bin/env python3
"""Links bun-profile again from the finished release build of /workspace/wt/parser with one rlib replaced.
usage: relink.py <tag> [<path of a replacement libbun_js_parser-*.rlib>] [full]     (run it through /workspace/tools/lk)
The link command, its inputs and flags are read from build/release/build.ninja. Outputs go to $OUT/<tag>/ (default
/tmp/paren-seam/link). Nothing is written into the worktree. A ThinLTO cache ($CACHE, default /tmp/paren-seam/thinlto-cache)
keeps the native object of every module, so only bun_js_parser and the modules that import from it are compiled again.
Two modes:
  full     the whole link: bun-profile, bun-profile.linker-map, link.log (about 6 minutes: bun_runtime imports from the parser).
           Without a replacement the result equals build/release/bun-profile in every section that holds code.
  harvest  (default when $OUT/HARVEST exists or HARVEST=1, unless `full` is given) the link is killed as soon as the ThinLTO
           cache holds the native object of the bun_js_parser module; that object is copied to $OUT/<tag>/bun_js_parser.lto.o.
           It is the machine code that the full link would place, before identical-code folding (about 2 minutes).
After its own tag the script works through $OUT/queue.txt (lines `<tag> [full]`, rlib at /tmp/paren-seam/out/<tag>/, or
`cg <tag> [<binary>]`: cgbench.sh on $OUT/<tag>/bun-profile, counts to /tmp/paren-seam/cg.<tag>.txt, or
`sh <tag> <command>`: a shell command in the worktree directory, output to /tmp/paren-seam/sh.<tag>.txt), so that a batch started
once under the lock can be extended without giving the lock back. While $OUT/HOLD holds the tag of the running
invocation, an empty queue is polled for up to ten minutes before the script ends."""
import os, re, signal, shutil, subprocess, sys, time
R = '/workspace/wt/parser/build/release'
OUT = os.environ.get('OUT', '/tmp/paren-seam/link')
CACHE = os.environ.get('CACHE', '/tmp/paren-seam/thinlto-cache')
RLIB = '/tmp/paren-seam/out/%s/libbun_js_parser-185fe25973f3a1f8.rlib'

def command(tag, repl):
    out = OUT + '/' + tag
    os.makedirs(out, exist_ok=True); os.makedirs(CACHE, exist_ok=True)
    text = open(R + '/build.ninja').read().replace('$\n', '')
    edge = None; lines = text.split('\n')
    for i, l in enumerate(lines):
        if l.startswith('build bun-profile |') and ': link ' in l: edge = i; break
    assert edge is not None, 'link edge not found'
    explicit = lines[edge].split(': link ', 1)[1].split(' | ')[0].split()
    ldflags = None
    for l in lines[edge + 1:edge + 12]:
        if l.startswith('  ldflags = '): ldflags = l[len('  ldflags = '):]
    assert ldflags
    n = 0
    for i, x in enumerate(explicit):
        if re.search(r'/libbun_js_parser-[0-9a-f]+\.rlib$', x):
            if repl: explicit[i] = repl
            n += 1
    assert n == 1, n
    open(out + '/bun-profile.rsp', 'w').write('\n'.join(explicit) + '\n')
    ldflags = ldflags.replace('-Wl,-Map=' + R + '/bun-profile.linker-map', '-Wl,-Map=' + out + '/bun-profile.linker-map')
    assert out in ldflags
    cmd = '/usr/lib/llvm-23/bin/clang++ @%s/bun-profile.rsp -Wl,@bun-profile.lazy.rsp %s -Wl,--thinlto-cache-dir=%s -o %s/bun-profile' % (out, ldflags, CACHE, out)
    open(out + '/link.cmd', 'w').write(cmd + '\n')
    return out, cmd

def is_parser_object(path):
    r = subprocess.run('llvm-nm --defined-only %s 2>/dev/null | grep -c -m1 16parse_paren_expr' % path, shell=True, capture_output=True, text=True)
    return r.stdout.strip() not in ('', '0')

def one(tag, repl, full):
    if repl and not os.path.exists(repl): print(tag, 'no rlib', repl, flush=True); return 1
    out, cmd = command(tag, repl)
    t = time.time()
    if full:
        r = subprocess.run(cmd, shell=True, cwd=R, capture_output=True, text=True)
        open(out + '/link.log', 'w').write(r.stdout + r.stderr)
        print(tag, 'full rc', r.returncode, 'seconds', int(time.time() - t), 'load', open('/proc/loadavg').read().split()[0], flush=True)
        if r.returncode: print((r.stdout + r.stderr)[-3000:], flush=True)
        return r.returncode
    before = set(os.listdir(CACHE)); seen = set()
    log = open(out + '/link.log', 'w')
    p = subprocess.Popen(cmd, shell=True, cwd=R, stdout=log, stderr=log, start_new_session=True)
    found = None
    while p.poll() is None and found is None:
        time.sleep(2)
        for name in set(os.listdir(CACHE)) - before - seen:
            path = CACHE + '/' + name
            if not name.startswith('llvmcache-'): continue
            seen.add(name)
            try:
                if os.path.getsize(path) > 3_000_000 and is_parser_object(path): found = path; break
            except OSError: pass
    if found:
        shutil.copyfile(found, out + '/bun_js_parser.lto.o')
        try: os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        p.wait()
        for leftover in ('bun-profile', 'bun-profile.linker-map'):
            if os.path.exists(out + '/' + leftover): os.remove(out + '/' + leftover)
        print(tag, 'harvest ok seconds', int(time.time() - t), os.path.basename(found), 'load', open('/proc/loadavg').read().split()[0], flush=True)
        return 0
    print(tag, 'harvest: the link ended first, rc', p.returncode, 'seconds', int(time.time() - t), '(the module was in the cache: use the binary)', flush=True)
    return p.returncode

def main():
    tag = sys.argv[1]
    rest = sys.argv[2:]
    full = 'full' in rest
    repl = next((os.path.abspath(a) for a in rest if a != 'full'), None)
    harvest = (os.path.exists(OUT + '/HARVEST') or os.environ.get('HARVEST')) and not full
    rc = one(tag, repl, not harvest)
    q = OUT + '/queue.txt'
    idle = 0
    while os.path.exists(q):
        lines = [l for l in open(q).read().splitlines() if l.strip()]
        if not lines:
            if os.path.exists(OUT + '/HOLD') and open(OUT + '/HOLD').read().strip() == tag and idle < 600: time.sleep(5); idle += 5; continue
            break
        idle = 0
        open(q, 'w').write('\n'.join(lines[1:]) + ('\n' if lines[1:] else ''))
        parts = lines[0].split()
        if parts[0] == 'cg':
            t = time.time()
            binary = parts[2] if len(parts) > 2 else OUT + '/' + parts[1] + '/bun-profile'
            r = subprocess.run(['/workspace/notes/lint/tools/cgbench.sh', binary, '/tmp/paren-seam/cg', parts[1], '20'], capture_output=True, text=True)
            open('/tmp/paren-seam/cg.' + parts[1] + '.txt', 'w').write(r.stdout + r.stderr)
            print('cg', parts[1], 'rc', r.returncode, 'seconds', int(time.time() - t), flush=True)
            continue
        if parts[0] == 'sh':
            t = time.time()
            r = subprocess.run(lines[0].split(None, 2)[2], shell=True, cwd='/workspace/wt/parser', capture_output=True, text=True)
            open('/tmp/paren-seam/sh.' + parts[1] + '.txt', 'w').write(r.stdout + r.stderr)
            print('sh', parts[1], 'rc', r.returncode, 'seconds', int(time.time() - t), flush=True)
            continue
        one(parts[0], RLIB % parts[0], 'full' in parts[1:])
    sys.exit(rc)

main()
