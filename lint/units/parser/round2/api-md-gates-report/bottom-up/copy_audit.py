#!/usr/bin/env python3
"""Lists every struct and enum of the node and side-table files that is not Copy, outside the test modules.
usage: copy_audit.py <repo root>"""
import re, sys, os
root = sys.argv[1]
files = ['src/ast/ts_nodes.rs', 'src/js_parser/parse/attached.rs', 'src/js_parser/parse/erased.rs',
         'src/js_parser/parse/generics.rs', 'src/js_parser/parse/wrappers.rs', 'src/js_parser/parse/syntax_errors.rs']
extra = sys.argv[2:]
total = 0; notcopy = []
for f in files + extra:
    p = os.path.join(root, f)
    if not os.path.exists(p): print('missing', f); continue
    lines = open(p).read().split('\n')
    end = next((i for i, l in enumerate(lines) if l.startswith('#[cfg(test)]')), len(lines))
    i = 0
    while i < end:
        m = re.match(r'\s*(pub(\([a-z]+\))? )?(struct|enum) (\w+)', lines[i])
        if m:
            j = i - 1; attrs = []
            while j >= 0 and (lines[j].lstrip().startswith('#[') or lines[j].lstrip().startswith('///')):
                attrs.append(lines[j]); j -= 1
            total += 1
            # bitflags and manual impls
            is_copy = any('Copy' in a for a in attrs) or any(re.search(r'impl(<[^>]*>)? (Copy|Clone) for ' + m.group(4) + r'\b', l) for l in lines[:end])
            if not is_copy: notcopy.append((f, i + 1, m.group(3), m.group(4)))
        i += 1
print(f'{total} types outside test modules, {len(notcopy)} not Copy:')
for f, ln, k, n in notcopy: print(f'  {f}:{ln} {k} {n}')
