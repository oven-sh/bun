#!/usr/bin/env python3
"""Machine code of the parser functions of two LINKED bun-profile binaries, function by function, without cachegrind.
usage: fncmp.py <base bun-profile> <head bun-profile> [--inst REGEX] [--all] [--diff NAME_REGEX] [--names-only]
Default --inst: 'P<false, ?(false|true)>' (what JavaScript runs). Use --inst . for every symbol of bun_js_parser.
Classes per demangled name (ThinLTO suffix cut):
  IDENT    the same instruction stream: jumps inside the function are labels numbered by first use, a call or a jump out
           is the name of its target (the const arguments of P cut: folded bodies carry either name), addresses of data
           are masked; the sink argument of the skipper is one name in both spellings
  OFFSETS  the same stream once every displacement of a memory operand is masked: a field moved (layout of P, of G::Fn ...);
           the same instructions and the same jumps run
  CONSTS   the same stream once every immediate is masked too (a size, a count, a shift): the same instructions, and the
           same jumps unless the constant is a loop bound
  DIFF     anything else; printed with bytes, instructions and conditional jumps of both sides
  ONLY-A / ONLY-B  the symbol is in one binary only
--diff prints a unified diff of the normalised streams of the functions whose name matches."""
import re, subprocess, sys, collections, difflib
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
INST = re.compile(arg('--inst', r'P<false, ?(false|true)>'))
DIFF = arg('--diff', None)
skipvals = {arg('--inst', None), DIFF}
paths = [a for a in sys.argv[1:] if not a.startswith('--') and a not in skipvals]
CC = re.compile(r'^j(?!mp)[a-z]+\s')
def clean(n):
    n = re.sub(r' \(\.llvm\.\d+\)', '', n)
    # the two spellings of the sink argument of the skipper are one name: <false>/<true> on main, the sink type after
    n = n.replace('::<bun_js_parser::parse::type_sink::Discard>', '::<SINK discard>').replace('::<bun_js_parser::parse::type_sink::DecoratorMetadata>', '::<SINK metadata>')
    n = re.sub(r'(skip_type_script_(?:type_with_opts|paren_or_fn_type))::<false>', r'\1::<SINK discard>', n)
    n = re.sub(r'(skip_type_script_(?:type_with_opts|paren_or_fn_type))::<true>', r'\1::<SINK metadata>', n)
    return n
def target(n):
    # a call out of the function: identical code folding keeps one body for P<true, false> and P<true, true>, under either name
    return re.sub(r'P<(true|false), ?(true|false)>', 'P', clean(n))
def load(path):
    nm = subprocess.run(['llvm-nm', '-S', '--defined-only', '-C', path], capture_output=True, text=True, errors='replace').stdout
    syms = []
    for line in nm.splitlines():
        m = re.match(r'^([0-9a-f]+) ([0-9a-f]+) (\w) (.*)$', line)
        if not m or m.group(3) not in 'tTwW' or 'bun_js_parser' not in m.group(4): continue
        syms.append((int(m.group(1), 16), int(m.group(2), 16), clean(m.group(4))))
    syms.sort()
    want = [(a, s, n) for a, s, n in syms if INST.search(n) and s > 0]
    # clusters of wanted symbols
    clusters = []
    for a, s, n in want:
        if clusters and a - clusters[-1][1] < 65536: clusters[-1][1] = max(clusters[-1][1], a + s)
        else: clusters.append([a, a + s])
    by_addr = collections.defaultdict(list)
    for a, s, n in want: by_addr[a].append((s, n))
    fns = {}
    for lo, hi in clusters:
        out = subprocess.run(['llvm-objdump', '-d', '--no-show-raw-insn', '-C', '--start-address=0x%x' % lo, '--stop-address=0x%x' % hi, path], capture_output=True, text=True, errors='replace').stdout
        cur = None; end = 0
        for line in out.splitlines():
            m = re.match(r'^([0-9a-f]+) <(.*)>:$', line)
            if m:
                a = int(m.group(1), 16)
                if a in by_addr: cur = a; end = a + max(s for s, _ in by_addr[a]); fns[a] = []
                elif cur is not None and a >= end: cur = None
                continue
            if cur is None: continue
            m = re.match(r'^\s*([0-9a-f]+):\s+(.*)$', line)
            if not m: continue
            off = int(m.group(1), 16)
            if off >= end: cur = None; continue
            fns[cur].append((off, m.group(2).strip()))
    res = {}
    for a, ins in fns.items():
        size = max(s for s, _ in by_addr[a]); lo, hi = a, a + size
        labels = {}; body = []
        def label(t):
            if t not in labels: labels[t] = 'L%d' % len(labels)
            return labels[t]
        for off, text in ins:
            text = re.sub(r'\s+', ' ', text)
            m = re.match(r'^(j\w+|call\w*|loop\w*) 0x([0-9a-f]+) <(.*)>$', text)
            if m:
                t = int(m.group(2), 16)
                if lo <= t < hi: text = m.group(1) + ' ' + label(t)
                else: text = m.group(1) + ' ' + target(re.sub(r'\+0x[0-9a-f]+$', '', m.group(3)))
            else:
                text = re.sub(r'\s*#.*$', '', text)
                text = re.sub(r'-?0x[0-9a-f]+\(%rip\)', 'RIP', text)
                text = re.sub(r'\$0x[0-9a-f]{6,}\b', '$ABS', text)
                text = re.sub(r'(?<![\w$])-?0x[0-9a-f]{6,}(?=\()', 'ABS', text)
                text = re.sub(r'\*0x[0-9a-f]{6,}\b', '*ABS', text)
            body.append((off, text))
        lines = []
        for off, text in body:
            if off in labels: lines.append(labels[off] + ':')
            lines.append(text)
        for s, n in by_addr[a]: res[n] = (size, lines)
    return res
def offsets(lines):
    return [re.sub(r'(?<![\w$])-?(0x[0-9a-f]+|\d+)(?=\()', 'D', l) for l in lines]
def loose(lines):
    return [re.sub(r'\$-?(0x[0-9a-f]+|\d+)\b', '$I', l) for l in offsets(lines)]
def stat(lines):
    ins = [l for l in lines if not re.match(r'^L\d+:$', l)]
    return len(ins), sum(1 for l in ins if CC.match(l))
A = load(paths[0]); B = load(paths[1])
rows = collections.defaultdict(list)
for n in sorted(set(A) | set(B)):
    if n not in A: rows['ONLY-B'].append((n, 0, B[n][0], (0, 0), stat(B[n][1]))); continue
    if n not in B: rows['ONLY-A'].append((n, A[n][0], 0, stat(A[n][1]), (0, 0))); continue
    (sa, la), (sb, lb) = A[n], B[n]
    if la == lb: k = 'IDENT'
    elif offsets(la) == offsets(lb): k = 'OFFSETS'
    elif loose(la) == loose(lb): k = 'CONSTS'
    else: k = 'DIFF'
    rows[k].append((n, sa, sb, stat(la), stat(lb)))
print('  '.join('%s %d' % (k, len(rows[k])) for k in ('IDENT', 'OFFSETS', 'CONSTS', 'DIFF', 'ONLY-A', 'ONLY-B')))
short = lambda n: re.sub(r'bun_js_parser::(p::)?', '', n)[:130]
for k in ('DIFF', 'ONLY-A', 'ONLY-B', 'CONSTS', 'OFFSETS'):
    if k == 'OFFSETS' and '--all' not in sys.argv: continue
    for n, sa, sb, (ia, ca), (ib, cb) in sorted(rows[k], key=lambda r: -abs(r[4][0] - r[3][0])):
        print('%-7s bytes %6d %6d (%+5d)  insns %5d %5d (%+5d)  jcc %4d %4d (%+4d)  %s' % (k, sa, sb, sb - sa, ia, ib, ib - ia, ca, cb, cb - ca, short(n)))
if DIFF:
    rx = re.compile(DIFF)
    for n in sorted(set(A) & set(B)):
        if rx.search(n) and A[n][1] != B[n][1]:
            print('====', short(n))
            for l in list(difflib.unified_diff(loose(A[n][1]) if '--loose' in sys.argv else A[n][1], loose(B[n][1]) if '--loose' in sys.argv else B[n][1], 'base', 'head', n=2, lineterm=''))[:int(arg('--max', '200'))]: print(l)
print('PASS' if not (rows['DIFF'] or rows['ONLY-A'] or rows['ONLY-B']) else 'FAIL: %d DIFF, %d only in base, %d only in head' % (len(rows['DIFF']), len(rows['ONLY-A']), len(rows['ONLY-B'])))
