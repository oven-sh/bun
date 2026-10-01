#!/usr/bin/env python3
"""Lists the public items of the files that API.md describes, outside their test modules, and marks each name that API.md does not hold.
usage: api_surface.py <repo root> <API.md> [more files relative to the root]"""
import re, sys, os
root, api = sys.argv[1], open(sys.argv[2], errors='replace').read()
files = ['src/js_parser/parse/parse_entry.rs', 'src/js_parser/p.rs', 'src/js_parser/parser.rs',
         'src/js_parser/parse/attached.rs', 'src/js_parser/parse/erased.rs', 'src/js_parser/parse/generics.rs',
         'src/js_parser/parse/wrappers.rs', 'src/js_parser/parse/syntax_errors.rs', 'src/ast/ts_nodes.rs'] + sys.argv[3:]
# p.rs and parser.rs hold the whole parser: only these types of them are part of the interface.
only = {'src/js_parser/p.rs': ('StartsForParseOnly',), 'src/js_parser/parser.rs': ('ScopeOrder',),
        'src/js_parser/parse/parse_entry.rs': ('ParsedOnly', 'ParsedForLint', 'Parser')}
missing = 0
for f in files:
    p = os.path.join(root, f)
    if not os.path.exists(p):
        print(f'-- {f}: no such file'); continue
    lines = open(p, errors='replace').read().split('\n')
    end = next((i for i, l in enumerate(lines) if l.startswith('#[cfg(test)]') and i + 1 < len(lines) and lines[i + 1].startswith('mod ')), len(lines))
    owner = None; depth_owner = None
    print(f'-- {f}')
    for i, l in enumerate(lines[:end]):
        m = re.match(r'(pub )?(struct|enum|trait) (\w+)', l) or re.match(r'impl(?:<[^>]*>)? (?:\w+(?:<[^>]*>)? for )?(\w+)', l)
        if m and not l.startswith(' '):
            owner = m.group(m.lastindex)
        m = re.match(r'    pub struct (\w+): \w+ \{', l)
        if m:
            owner = m.group(1)
            if f in only and owner not in only[f]:
                continue
            known = re.search(r'\b' + owner + r'\b', api) is not None
            missing += 0 if known else 1
            print(f"  {'   ' if known else '!! '}{f.rsplit('/', 1)[1]}:{i + 1} flags {owner}")
            continue
        # What is `pub` on the parser itself is for the parser: no other crate holds a `P`.
        if owner == 'P':
            continue
        if f in only and owner not in only[f]:
            continue
        item = None
        m = re.match(r'\s*pub (?:const |unsafe )*fn (\w+)', l)
        if m: item = ('fn', m.group(1))
        m = re.match(r'pub (struct|enum|trait|type|const) (\w+)', l)
        if m: item = (m.group(1), m.group(2))
        m = re.match(r'    pub (\w+): ', l)
        if m: item = ('field', m.group(1))
        m = re.match(r'        const (\w+) = ', l)
        if m and owner: item = ('flag', m.group(1))
        if not item: continue
        kind, name = item
        # The bundler's scan pass is no part of the lint interface.
        if (owner, name) == ('Parser', 'scan_imports'):
            continue
        known = re.search(r'\b' + re.escape(name) + r'\b', api) is not None
        if not known: missing += 1
        print(f"  {'   ' if known else '!! '}{f.rsplit('/', 1)[1]}:{i + 1} {kind} {owner + '::' if owner and kind in ('fn', 'field', 'flag') else ''}{name}")
print(f'{missing} public names that API.md does not hold (marked !!)')
