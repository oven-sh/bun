#!/usr/bin/env python3
"""Functions of the bun_js_parser module as the ThinLTO link compiles them (the object that `relink.py` harvests).
usage: objfn.py <a.o> [--match REGEX] [--calls]
       objfn.py <a.o> <b.o> --cmp [--match REGEX] [--diff N] [--all]
Per function: bytes (symbol size), instructions, conditional branches, calls. --cmp says SAME when the instruction
streams are equal after normalisation: a call or a data reference is named by its relocation, a jump inside the function
by a label numbered in order of first use. REGEX is matched on the demangled name. --all lists every function that differs."""
import re, subprocess, sys, difflib
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
DEFAULT = r'>::(parse_paren_expr\w*|parse_prefix|parse_suffix|parse_async_prefix_expr|restore_parser_snapshot|parser_snapshot|pfx_t_\w+|sfx_t_\w+|is_type_script_arrow_return_type_after_question_and_before_colon.*|try_skip_type_script_\w+|lexer_backtracker_\w+(::<.*>)?|parse_arrow_body|parse_expr_common|skip_type_script_type_with_opts(::<.*>)?|skip_type_script_type_parameters|skip_type_script_type_arguments(::<.*>)?|skip_type_script_type_of_arrow_parameter|skip_typescript_return_type_of_arrow|convert_expr_to_binding_and_initializer|pop_and_flatten_scope|push_scope_for_parse_pass|is_ts_arrow_fn_jsx|parse_jsx_element|parse_fn_body|lint_\w+)$'
rx = re.compile(arg('--match', DEFAULT))
CC = re.compile(r'^j(?!mp)[a-z]+\s')
def clean(n): return re.sub(r' \(\.llvm\.\d+\)', '', n).replace('bun_js_parser::', '').replace('parse::type_sink::', '')
def load(path):
    nm = subprocess.run(['llvm-nm', '-S', '--defined-only', '-C', path], capture_output=True, text=True, errors='replace').stdout
    size = {}
    for line in nm.splitlines():
        m = re.match(r'^([0-9a-f]+) ([0-9a-f]+) (\w) (.*)$', line)
        if m and m.group(3) in 'tTwW': size[clean(m.group(4))] = int(m.group(2), 16)
    out = subprocess.run(['llvm-objdump', '-d', '-r', '--no-show-raw-insn', '-C', path], capture_output=True, text=True, errors='replace').stdout
    fns = {}; cur = None
    for line in out.splitlines():
        m = re.match(r'^[0-9a-f]+ <(.*)>:$', line)
        if m: cur = clean(m.group(1)); fns[cur] = []; continue
        if cur is None: continue
        m = re.match(r'^\s*([0-9a-f]+):\s+(R_X86_64_\w+)\s+(.*)$', line)
        if m:
            if fns[cur]:
                rel = clean(re.sub(r'[-+]0x[0-9a-f]+$', '', m.group(3)))
                rel = re.sub(r'\.llvm\.\d+', '', rel)
                if re.match(r'^\.(l?rodata|data|bss|text)\b', rel) or 'Lanon.' in rel or rel.startswith(('anon.', '.L')): rel = '<data>'
                fns[cur][-1][2] = rel
            continue
        m = re.match(r'^\s*([0-9a-f]+):\s+(.*)$', line)
        if m: fns[cur].append([int(m.group(1), 16), m.group(2).strip(), None])
    norm = {}
    for name, ins in fns.items():
        if not ins: continue
        base = ins[0][0]; labels = {}; lines = []
        def label(off):
            if off not in labels: labels[off] = 'L%d' % len(labels)
            return labels[off]
        body = []
        for off, text, rel in ins:
            text = re.sub(r'\s+', ' ', text)
            op = text.split(' ', 1)[0]
            if rel is not None:
                if op.startswith(('call', 'jmp', 'j')): text = op + ' ' + rel
                else:
                    data = rel if rel == '<data>' else '<' + rel + '>'
                    text = re.sub(r'(-?0x[0-9a-f]+|\b\d+)?\(%rip\)', data, text, count=1)
                    text = re.sub(r'\s*<[^<>]*(<[^<>]*>[^<>]*)*\+0x[0-9a-f]+>$', '', text)
                    text = re.sub(r'\$0x0\b', '$' + data, text) if '(%rip)' not in text and data not in text else text
            else:
                m = re.match(r'^(j\w+|call\w*|loop\w*)\s+0x([0-9a-f]+)\s+<.*>$', text)
                if m: text = m.group(1) + ' ' + label(int(m.group(2), 16))
            text = re.sub(r'\s*# 0x[0-9a-f]+.*$', '', text)
            body.append((off, text))
        for off, text in body:
            if off in labels: lines.append(labels[off] + ':')
            lines.append(text)
        norm[name] = lines
    return norm, size
def stat(lines):
    ins = [l for l in lines if not re.match(r'^L\d+:$', l)]
    return len(ins), sum(1 for l in ins if CC.match(l)), [l.split(' ', 1)[1] for l in ins if l.startswith('call') and ' ' in l]
paths = [a for a in sys.argv[1:] if not a.startswith('--') and a not in (arg('--match', None), arg('--diff', None))]
if '--cmp' not in sys.argv:
    a, sa = load(paths[0])
    print('%7s %6s %5s %5s  %s' % ('bytes', 'insns', 'jcc', 'calls', 'function'))
    for n in sorted(a):
        if not rx.search(n): continue
        i, c, calls = stat(a[n])
        print('%7d %6d %5d %5d  %s' % (sa.get(n, 0), i, c, len(calls), n[:150]))
        if '--calls' in sys.argv:
            seen = {}
            for x in calls: seen[x] = seen.get(x, 0) + 1
            for x, k in sorted(seen.items()): print('            %2d x %s' % (k, x[:140]))
    sys.exit(0)
(a, sa), (b, sb) = load(paths[0]), load(paths[1])
same = [n for n in a if n in b and a[n] == b[n]]; diff = sorted(n for n in a if n in b and a[n] != b[n])
onlya = sorted(set(a) - set(b)); onlyb = sorted(set(b) - set(a))
ta = sum(sa.get(n, 0) for n in a); tb = sum(sb.get(n, 0) for n in b)
print('functions a %d b %d: identical %d, different %d, only a %d, only b %d; text bytes a %d b %d (%+d)' % (len(a), len(b), len(same), len(diff), len(onlya), len(onlyb), ta, tb, tb - ta))
def row(tag, n):
    ia = ca = ib = cb = ''
    if n in a: ia, ca, _ = stat(a[n])
    if n in b: ib, cb, _ = stat(b[n])
    print('%-6s %7s %7s %6s %6s %5s %5s  %s' % (tag, sa.get(n, '') if n in a else '', sb.get(n, '') if n in b else '', ia, ib, ca, cb, n[:150]))
print('%-6s %7s %7s %6s %6s %5s %5s  %s' % ('', 'bytesA', 'bytesB', 'insnA', 'insnB', 'jccA', 'jccB', 'function'))
for n in diff: row('DIFF', n) if ('--all' in sys.argv or rx.search(n)) else None
rest = [n for n in diff if not rx.search(n)]
if rest and '--all' not in sys.argv: print('       (%d more functions differ outside --match: %s)' % (len(rest), '; '.join(x[:60] for x in rest[:6])))
for n in onlya: row('ONLY-A', n)
for n in onlyb: row('ONLY-B', n)
if '--same' in sys.argv:
    for n in sorted(same):
        if rx.search(n): row('SAME', n)
nd = int(arg('--diff', 0))
for n in [x for x in diff if rx.search(x)][:nd]:
    print('---', n[:150])
    for l in list(difflib.unified_diff(a[n], b[n], lineterm='', n=2))[:int(arg('--lines', 90))]: print('   ', l)
