#!/usr/bin/env python3
"""Per-function numbers from the assembly that `EMIT=asm run.py` writes (code BEFORE the ThinLTO link): instructions, conditional branches, calls.
usage: fnstat.py <out dir of a tag> [--match REGEX] [--calls]   (REGEX is matched on the demangled name)
       fnstat.py <out dir A> <out dir B> --cmp [--match REGEX] [--diff N]
--cmp prints, per function present in both, whether the normalized assembly is identical, and the deltas."""
import re, subprocess, sys, glob, difflib
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
DEFAULT = r'>::(parse_paren_expr|parse_prefix|parse_suffix|parse_async_prefix_expr|restore_parser_snapshot|parser_snapshot|pfx_t_open_paren|is_type_script_arrow_return_type_after_question_and_before_colon|try_skip_type_script_\w+|lexer_backtracker_\w+(::<.*>)?|parse_arrow_body|parse_fn_stmt|parse_stmt|parse_property|parse_expr_or_bindings|parse_expr_common|skip_type_script_type_with_opts(::<.*>)?|skip_type_script_type_parameters|skip_type_script_type_arguments(::<.*>)?|convert_expr_to_binding_and_initializer|pop_and_flatten_scope)$'
rx = re.compile(arg('--match', DEFAULT))
CC = re.compile(r'^j(?!mp)[a-z]+\s')
def sizes(d):
    o = glob.glob(d + '/*.o')
    if not o: return {}
    o = o[0]
    out = subprocess.run(['llvm-nm', '-S', '--defined-only', '-C', o], capture_output=True, text=True, errors='replace').stdout
    res = {}
    for line in out.splitlines():
        m = re.match(r'^([0-9a-f]+) ([0-9a-f]+) (\w) (.*)$', line)
        if m and m.group(3) in 'tTwW': res[m.group(4)] = (int(m.group(2), 16), m.group(3))
    return res
def load(d):
    path = glob.glob(d + '/*.s')[0]
    text = subprocess.run(['llvm-cxxfilt'], stdin=open(path), capture_output=True, text=True, errors='replace').stdout
    fns = {}; cur = None; body = []
    for line in text.splitlines():
        m = re.match(r'^\t\.type\t(.*),@function$', line)
        if m: cur = m.group(1); body = []; continue
        if cur is None: continue
        if line.startswith('\t.size\t') or line.startswith('\t.cfi_endproc'):
            if cur not in fns: fns[cur] = body
            cur = None; continue
        s = line.strip()
        if not s or s.startswith(('.cfi', '.loc', '.file', '#', '.p2align', '.section', '.globl', '.hidden', '.weak', '.type')): continue
        if s.endswith(':') and not s.startswith('.L'): continue
        body.append(s)
    out = {}
    for name, body in fns.items():
        labels = {}
        def lab(m):
            k = m.group(0)
            if k.startswith(('.L__unnamed', '.Lanon', '.Lalloc', '.Lswitch.table', '.LCPI', '.Lstr')): return '.Ldata'
            if k not in labels: labels[k] = '.L%d' % len(labels)
            return labels[k]
        out[name] = [re.sub(r'\.L[\w.$]+', lab, l) for l in body]
    return out
def stat(lines):
    ins = [l for l in lines if not l.endswith(':')]
    cc = [l for l in ins if CC.match(l)]
    calls = [l.split(None, 1)[1] for l in ins if l.startswith('call')]
    return len(ins), len(cc), calls
def short(n): return n.replace('bun_js_parser::', '').replace('parse::type_sink::', '')[:150]
dirs = [a for a in sys.argv[1:] if not a.startswith('--') and a not in (arg('--match', None), arg('--diff', None))]
if '--cmp' not in sys.argv:
    a = load(dirs[0]); sa = sizes(dirs[0])
    print('%7s %6s %5s %5s  %s' % ('bytes', 'insns', 'jcc', 'calls', 'function'))
    for n in sorted(a):
        if not rx.search(n): continue
        i, c, calls = stat(a[n])
        print('%7d %6d %5d %5d  %s' % (sa.get(n, (0, '?'))[0], i, c, len(calls), short(n)))
        if '--calls' in sys.argv:
            seen = {}
            for x in calls: seen[x] = seen.get(x, 0) + 1
            for x, k in sorted(seen.items()): print('            %2d x %s' % (k, short(x)))
    sys.exit(0)
a = load(dirs[0]); b = load(dirs[1]); sa = sizes(dirs[0]); sb = sizes(dirs[1])
whole_same = sum(1 for n in a if n in b and a[n] == b[n]); whole_diff = sorted(n for n in a if n in b and a[n] != b[n])
tot = lambda s: sum(v[0] for v in s.values())
print('all functions: a %d b %d; identical %d; different %d; only a %d; only b %d; text bytes a %d b %d (%+d)' % (len(a), len(b), whole_same, len(whole_diff), len(set(a) - set(b)), len(set(b) - set(a)), tot(sa), tot(sb), tot(sb) - tot(sa)))
print('%-9s %7s %7s %6s %6s %5s %5s  %s' % ('', 'bytesA', 'bytesB', 'insnA', 'insnB', 'jccA', 'jccB', 'function'))
for n in sorted(set(a) | set(b)):
    sel = rx.search(n) or (n in whole_diff and '--all-diff' in sys.argv)
    if not sel: continue
    if n in a and n in b:
        ia, ca, _ = stat(a[n]); ib, cb, _ = stat(b[n])
        print('%-9s %7d %7d %6d %6d %5d %5d  %s' % ('SAME' if a[n] == b[n] else 'DIFF', sa.get(n, (0,))[0], sb.get(n, (0,))[0], ia, ib, ca, cb, short(n)))
    elif n in a:
        ia, ca, _ = stat(a[n]); print('%-9s %7d %7s %6d %6s %5d %5s  %s' % ('ONLY-A', sa.get(n, (0,))[0], '', ia, '', ca, '', short(n)))
    else:
        ib, cb, _ = stat(b[n]); print('%-9s %7s %7d %6s %6d %5s %5d  %s' % ('ONLY-B', '', sb.get(n, (0,))[0], '', ib, '', cb, short(n)))
others = [n for n in whole_diff if not rx.search(n)]
if others and '--all-diff' not in sys.argv:
    print('other functions that differ (%d):' % len(others))
    for n in others[:40]:
        ia, ca, _ = stat(a[n]); ib, cb, _ = stat(b[n]); print('   %6d -> %6d insns, %4d -> %4d jcc  %s' % (ia, ib, ca, cb, short(n)))
onlyb = sorted(set(b) - set(a))
if onlyb:
    print('only in b (%d):' % len(onlyb))
    for n in onlyb[:60]:
        ib, cb, _ = stat(b[n]); print('   %7d bytes %6d insns %4d jcc  %s' % (sb.get(n, (0,))[0], ib, cb, short(n)))
onlya = sorted(set(a) - set(b))
if onlya:
    print('only in a (%d):' % len(onlya))
    for n in onlya[:60]:
        ia, ca, _ = stat(a[n]); print('   %7d bytes %6d insns %4d jcc  %s' % (sa.get(n, (0,))[0], ia, ca, short(n)))
nd = int(arg('--diff', 0))
for n in [x for x in whole_diff if rx.search(x)][:nd]:
    print('---', short(n))
    for l in list(difflib.unified_diff(a[n], b[n], lineterm='', n=2))[:120]: print('   ', l)
