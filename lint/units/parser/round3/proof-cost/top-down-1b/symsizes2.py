#!/usr/bin/env python3
"""Parser symbol sizes of a bun-profile binary, counted by address (symsizes.py of /workspace/notes/lint/tools), with the
code that only a lint parse reaches counted apart.
usage: symsizes2.py <bun-profile> [--lint REGEX] [--json]
An address is lint-only when every name at it matches --lint (default: the modules and name prefixes of the lint parse).
Rows: the whole parser text; the lint-only part; the rest; then the four P rows, each without its lint-only part and with
the lint-only part beside it, and the type skipper by sink."""
import re, subprocess, sys, json, collections
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
binary = [a for a in sys.argv[1:] if not a.startswith('--') and a != arg('--lint', None)][0]
LINT = re.compile(arg('--lint', r'parse::(erased|wrappers|attached|generics|syntax_errors|lint[a-z_]*)::|ForLint|for_lint|type_sink::Build|::lint_[a-z_]+'))
out = subprocess.run(['llvm-nm', '-S', '--defined-only', '-C', binary], capture_output=True, text=True, errors='replace').stdout
by_addr = {}
for line in out.splitlines():
    m = re.match(r'^([0-9a-f]+) ([0-9a-f]+) (\w) (.*)$', line)
    if not m or m.group(3) not in 'tTwW' or 'bun_js_parser' not in m.group(4): continue
    by_addr.setdefault(int(m.group(1), 16), []).append((int(m.group(2), 16), m.group(4)))
size = {a: max(s for s, _ in v) for a, v in by_addr.items()}
lint = {a for a, v in by_addr.items() if all(LINT.search(n) for _, n in v)}
def total(addrs): return (len(addrs), sum(size[a] for a in addrs))
res = collections.OrderedDict()
res['bun_js_parser text'] = total(set(by_addr)); res['  lint-only'] = total(lint); res['  without lint-only'] = total(set(by_addr) - lint)
for label, pat in [('P<false, false>', r'P<false, ?false>'), ('P<true, false>', r'P<true, ?false>'), ('P<false, true>', r'P<false, ?true>'), ('P<true, true>', r'P<true, ?true>')]:
    rx = re.compile(pat)
    # as symsizes.py: an address counts for a row when one of its names has the row's P
    mine = {a for a, v in by_addr.items() if any(rx.search(n) for _, n in v)}
    only = {a for a in mine if all(LINT.search(n) for _, n in by_addr[a] if rx.search(n))}
    res[label] = total(mine - only); res['  ' + label + ' lint-only'] = total(only)
for label, pat in [('skipper, Discard', r'(skip_type_?script|skip_typescript).*(::<false>$|type_sink::Discard)'), ('skipper, DecoratorMetadata', r'(skip_type_?script|skip_typescript).*(::<true>$|type_sink::DecoratorMetadata)'),
                   ('skipper, no sink argument', r'^(?!.*(::<(true|false)>$|type_sink::)).*(skip_type_?script|skip_typescript)')]:
    rx = re.compile(pat)
    res[label] = total({a for a, v in by_addr.items() if any(rx.search(n) for _, n in v)})
if '--json' in sys.argv: print(json.dumps(res)); sys.exit(0)
for k, (n, b) in res.items(): print(f'{k:34} {n:5} {b:>10,}')
