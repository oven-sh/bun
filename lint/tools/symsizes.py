#!/usr/bin/env python3
"""Parser symbol sizes of a bun-profile binary, counted by address.
usage: symsizes.py <bun-profile> [--json]"""
import re, subprocess, sys, json, collections
binary = sys.argv[1]
out = subprocess.run(['llvm-nm', '-S', '--defined-only', '-C', binary], capture_output=True, text=True, errors='replace').stdout
by_addr = {}
for line in out.splitlines():
    m = re.match(r'^([0-9a-f]+) ([0-9a-f]+) (\w) (.*)$', line)
    if not m or m.group(3) not in 'tTwW': continue
    name = m.group(4)
    if 'bun_js_parser' not in name: continue
    by_addr.setdefault(int(m.group(1), 16), []).append((int(m.group(2), 16), name))
res = collections.OrderedDict()
res['bun_js_parser text'] = (len(by_addr), sum(max(s for s, _ in v) for v in by_addr.values()))
for label, pat in [('P<false, false>', r'P<false, ?false>'), ('P<true, false>', r'P<true, ?false>'), ('P<false, true>', r'P<false, ?true>'), ('P<true, true>', r'P<true, ?true>')]:
    a = {k: max(s for s, n in v if re.search(pat, n)) for k, v in by_addr.items() if any(re.search(pat, n) for _, n in v)}
    res[label] = (len(a), sum(a.values()))
g = {k: max(s for s, n in v) for k, v in by_addr.items() if any(re.search(r'skip_type_?script|skip_typescript|type_sink', n) for _, n in v)}
res['type grammar'] = (len(g), sum(g.values()))
def one(pat):
    return sorted({(s, n) for v in by_addr.values() for s, n in v if re.search(pat, n)}, reverse=True)
for label, pat in [('with_opts discard', r'P<true, ?false>>::skip_type_script_type_with_opts::<(false|bun_js_parser::parse::type_sink::Discard)>'),
                   ('with_opts metadata', r'P<true, ?false>>::skip_type_script_type_with_opts::<(true|bun_js_parser::parse::type_sink::DecoratorMetadata)>'),
                   ('parse_suffix TS', r'P<true, ?false>>::parse_suffix$'), ('parse_prefix TS', r'P<true, ?false>>::parse_prefix$'),
                   ('parse_property TS', r'P<true, ?false>>::parse_property$'), ('parse_fn_stmt TS', r'P<true, ?false>>::parse_fn_stmt$'),
                   ('parse_stmt TS', r'P<true, ?false>>::parse_stmt$'), ('Lexer::next', r'lexer::Lexer>::next$')]:
    c = one(pat)
    res[label] = (len(c), c[0][0] if c else 0)
if '--json' in sys.argv: print(json.dumps(res)); sys.exit(0)
for k, (n, b) in res.items(): print(f'{k:24} {n:5} {b:>10,}')
