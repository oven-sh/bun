#!/usr/bin/env python3
"""Machine code of the parser functions of two LINKED bun-profile binaries, function by function (fncmp.py, made robust
against identical code folding).
usage: fncmp2.py <a bun-profile> <b bun-profile> [--inst REGEX | --strict | --ts] [--allow-only-b REGEX] [--all]
                 [--diff NAME_REGEX] [--loose] [--max N]
Differences to fncmp.py:
  * A call or jump out of a function is named by the CLASS of its target: every text symbol of a binary that shares an
    address is one class (identical code folding), and a class of binary a and one of binary b that share a name are one
    class. llvm-objdump labels a folded address with one of its names, and which one depends on the other names there.
  * --strict   every symbol of bun_js_parser that a parse of TypeScript (not scan-only) does not own: all but the names
               with <true, false> and Parser::_parse::<true>. This is what JavaScript and every scan-only parse run.
    --ts       the complement of --strict.
  * --allow-only-b REGEX   a symbol that only b has and whose name matches is listed as LINT-ONLY and does not fail.
Classes per demangled name: IDENT, OFFSETS (equal once displacements are masked), CONSTS (equal once immediates are
masked too), DIFF, ONLY-A, ONLY-B, LINT-ONLY. Exit status 1 when a DIFF, ONLY-A or ONLY-B row is left."""
import re, subprocess, sys, collections, difflib
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
STRICT = r'^(?!.*(<true, ?false>|_parse::?<true>))'
TS = r'<true, ?false>|_parse::?<true>'
INST = re.compile(STRICT if '--strict' in sys.argv else TS if '--ts' in sys.argv else arg('--inst', r'P<false, ?(false|true)>'))
DIFF = arg('--diff', None); ALLOW = arg('--allow-only-b', None); ALLOW_RX = re.compile(ALLOW) if ALLOW else None
skipvals = {arg('--inst', None), DIFF, ALLOW, arg('--max', None)}
paths = [a for a in sys.argv[1:] if not a.startswith('--') and a not in skipvals]
CC = re.compile(r'^j(?!mp)[a-z]+\s')
def clean(n):
    n = re.sub(r' \(\.llvm\.\d+\)', '', n)
    n = n.replace('::<bun_js_parser::parse::type_sink::Discard>', '::<SINK discard>').replace('::<bun_js_parser::parse::type_sink::DecoratorMetadata>', '::<SINK metadata>')
    n = re.sub(r'(skip_type_script_(?:type_with_opts|paren_or_fn_type))::<false>', r'\1::<SINK discard>', n)
    n = re.sub(r'(skip_type_script_(?:type_with_opts|paren_or_fn_type))::<true>', r'\1::<SINK metadata>', n)
    return n
def cutp(n): return re.sub(r'P<(true|false), ?(true|false)>', 'P', n)
parent = {}
def find(x):
    while parent.setdefault(x, x) != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x
def union(a, b):
    a, b = find(a), find(b)
    if a != b: parent[max(a, b)] = min(a, b)
def symbols(path):
    nm = subprocess.run(['llvm-nm', '-S', '--defined-only', '-C', path], capture_output=True, text=True, errors='replace').stdout
    syms = []; at = collections.defaultdict(list)
    for line in nm.splitlines():
        m = re.match(r'^([0-9a-f]+) ([0-9a-f]+) (\w) (.*)$', line)
        if not m or m.group(3) not in 'tTwW': continue
        a = int(m.group(1), 16); n = clean(m.group(4))
        at[a].append(n)
        if 'bun_js_parser' in n: syms.append((a, int(m.group(2), 16), n))
    for a, names in at.items():
        first = cutp(names[0])
        for n in names: union(first, cutp(n))
    return sorted(syms), at
def load(path, syms, at):
    want = [(a, s, n) for a, s, n in syms if INST.search(n) and s > 0]
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
                else:
                    # the class of the target: by its address when a symbol starts there, else by the printed name
                    if t in at: name = cutp(at[t][0]); plus = ''
                    else:
                        raw = m.group(3); x = re.search(r'\+0x[0-9a-f]+$', raw)
                        name = cutp(clean(raw[:x.start()] if x else raw)); plus = '+mid'
                    text = m.group(1) + ' @' + name + plus
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
def canon(lines):
    # call targets by class, after the classes of both binaries are known
    out = []
    for l in lines:
        i = l.find(' @')
        if i > 0:
            t = l[i + 2:]; mid = t.endswith('+mid')
            if mid: t = t[:-4]
            l = l[:i] + ' ' + find(t) + ('+mid' if mid else '')
        out.append(l)
    return out
def offsets(lines): return [re.sub(r'(?<![\w$])-?(0x[0-9a-f]+|\d+)(?=\()', 'D', l) for l in lines]
def loose(lines): return [re.sub(r'\$-?(0x[0-9a-f]+|\d+)\b', '$I', l) for l in offsets(lines)]
def stat(lines):
    ins = [l for l in lines if not re.match(r'^L\d+:$', l)]
    return len(ins), sum(1 for l in ins if CC.match(l))
sa, ata = symbols(paths[0]); sb, atb = symbols(paths[1])
A = load(paths[0], sa, ata); B = load(paths[1], sb, atb)
A = {n: (s, canon(l)) for n, (s, l) in A.items()}; B = {n: (s, canon(l)) for n, (s, l) in B.items()}
rows = collections.defaultdict(list)
for n in sorted(set(A) | set(B)):
    if n not in A:
        rows['LINT-ONLY' if ALLOW_RX and ALLOW_RX.search(n) else 'ONLY-B'].append((n, 0, B[n][0], (0, 0), stat(B[n][1]))); continue
    if n not in B: rows['ONLY-A'].append((n, A[n][0], 0, stat(A[n][1]), (0, 0))); continue
    (za, la), (zb, lb) = A[n], B[n]
    if la == lb: k = 'IDENT'
    elif offsets(la) == offsets(lb): k = 'OFFSETS'
    elif loose(la) == loose(lb): k = 'CONSTS'
    else: k = 'DIFF'
    rows[k].append((n, za, zb, stat(la), stat(lb)))
KINDS = ('IDENT', 'OFFSETS', 'CONSTS', 'DIFF', 'ONLY-A', 'ONLY-B', 'LINT-ONLY')
print('  '.join('%s %d' % (k, len(rows[k])) for k in KINDS))
short = lambda n: re.sub(r'bun_js_parser::(p::)?', '', n)[:130]
for k in ('DIFF', 'ONLY-A', 'ONLY-B', 'CONSTS', 'OFFSETS', 'LINT-ONLY'):
    if k in ('OFFSETS', 'LINT-ONLY') and '--all' not in sys.argv: continue
    for n, za, zb, (ia, ca), (ib, cb) in sorted(rows[k], key=lambda r: -abs(r[4][0] - r[3][0])):
        print('%-9s bytes %6d %6d (%+5d)  insns %5d %5d (%+5d)  jcc %4d %4d (%+4d)  %s' % (k, za, zb, zb - za, ia, ib, ib - ia, ca, cb, cb - ca, short(n)))
if DIFF:
    rx = re.compile(DIFF)
    for n in sorted(set(A) & set(B)):
        if rx.search(n) and A[n][1] != B[n][1]:
            print('====', short(n))
            x, y = (loose(A[n][1]), loose(B[n][1])) if '--loose' in sys.argv else (A[n][1], B[n][1])
            for l in list(difflib.unified_diff(x, y, 'a', 'b', n=2, lineterm=''))[:int(arg('--max', '200'))]: print(l)
bad = len(rows['DIFF']) + len(rows['ONLY-A']) + len(rows['ONLY-B'])
print('PASS' if not bad else 'FAIL: %d DIFF, %d only in a, %d only in b' % (len(rows['DIFF']), len(rows['ONLY-A']), len(rows['ONLY-B'])))
sys.exit(1 if bad else 0)
