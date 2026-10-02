#!/usr/bin/env python3
"""The calls that the tree makes into checker/c30_type_keys.rs, by reading: the argument count of each call of a key function
and of each write of a KeyBuilder named `b` against the parameter count of the definition, and the names of the module
that the files of the crate import through `crate::checker`. It compares counts, not types.
usage: c30-callsites.py [crate directory, default src/typecheck of the worktree]   exit 1 when a count differs"""
import os, re, sys
root = sys.argv[1] if len(sys.argv) > 1 else '/workspace/wt/typecheck/src/typecheck'
FREE = {
    'get_type_list_key': 1, 'get_alias_key': 2, 'get_union_key': 4, 'get_intersection_key': 4, 'get_tuple_key': 2,
    'get_type_alias_instantiation_key': 3, 'get_type_instantiation_key': 4, 'get_indexed_access_key': 5,
    'get_template_type_key': 2, 'get_conditional_type_key': 4, 'get_relation_key': 6, 'get_node_list_key': 1,
    'is_type_reference_with_generic_arguments': 2, 'is_non_deferred_type_reference': 2, 'is_unconstrained_type_parameter': 2,
}
METHODS = {'write_byte': 1, 'write_string': 1, 'write_uint32': 1, 'write_uint64': 1, 'write_int': 1, 'write_symbol': 2,
           'write_type': 1, 'write_types': 1, 'write_alias': 2, 'write_generic_type_references': 4, 'write_node_id': 1,
           'write_node': 1, 'hash': 0}
NAMES = ['CacheHashKey', 'KeyBuilder'] + list(FREE)
USE = re.compile(r'use\s+crate::checker::(?:c30_type_keys::)?\{([^}]*)\}\s*;|use\s+crate::checker::(?:c30_type_keys::)?([A-Za-z_][A-Za-z0-9_]*)\s*;', re.S)


def args_of(text, i):
    # `i` is at the opening parenthesis: the arguments at depth one.
    depth, cur, out = 0, '', []
    for ch in text[i:]:
        if ch in '([{':
            depth += 1
            if depth > 1: cur += ch
        elif ch in ')]}':
            depth -= 1
            if depth == 0:
                if cur.strip(): out.append(cur.strip())
                return out
            cur += ch
        elif ch == ',' and depth == 1:
            if cur.strip(): out.append(cur.strip())
            cur = ''
        else:
            cur += ch
    return out


bad, calls, files, imports = 0, 0, set(), {}
for d, _, fs in os.walk(root):
    for f in sorted(fs):
        p = os.path.join(d, f)
        if not f.endswith('.rs') or p.endswith('checker/c30_type_keys.rs'): continue
        text = open(p, errors='replace').read()
        found = []
        for name, want in FREE.items():
            for m in re.finditer(r'(?<![A-Za-z0-9_\.])' + name + r'\s*\(', text):
                if text[max(0, m.start() - 3):m.start()] == 'fn ': continue
                found.append((m, name, want))
        for name, want in METHODS.items():
            for m in re.finditer(r'\bb\.' + name + r'\s*\(', text):
                found.append((m, 'b.' + name, want))
        for m, name, want in found:
            calls += 1; files.add(os.path.relpath(p, root))
            got = len(args_of(text, m.end() - 1))
            if got != want:
                bad += 1; print('%s:%d %s has %d arguments, the definition takes %d' % (p, text.count('\n', 0, m.start()) + 1, name, got, want))
        for m in USE.finditer(text):
            for n in re.findall(r'[A-Za-z_][A-Za-z0-9_]*', m.group(1) or m.group(2)):
                if n in NAMES: imports.setdefault(n, []).append(os.path.basename(p)[:-3])
print('%d calls in %d files, %d with another argument count' % (calls, len(files), bad))
print('%d names imported at %d sites: %s' % (len(imports), sum(len(v) for v in imports.values()),
                                            ', '.join('%s %d' % (n, len(imports[n])) for n in NAMES if n in imports)))
sys.exit(1 if bad else 0)
