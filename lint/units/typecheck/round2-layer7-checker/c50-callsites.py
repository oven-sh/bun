#!/usr/bin/env python3
"""The calls that the tree makes into checker/c50_contextual_properties_inference_context.rs, by reading: the argument
count of each call `.NAME(` of a method of the file against the parameter count of its definition (read from the file, the
receiver aside), the fields of each `ObjectLiteralDiscriminator { ... }` literal, and the files that import the record
through `crate::checker`. It compares counts and field names, not types.
usage: c50-callsites.py [crate directory, default src/typecheck of the worktree]   exit 1 when a count or a field differs"""
import os, re, sys
root = sys.argv[1] if len(sys.argv) > 1 else '/workspace/wt/typecheck/src/typecheck'
own = os.path.join(root, 'checker/c50_contextual_properties_inference_context.rs')


def args_of(text, i):
    # `i` is at the opening parenthesis or brace: the arguments at depth one.
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


src = open(own).read()
METHODS = {}
for m in re.finditer(r'^    pub fn ([a-z_0-9]+)\s*\(', src, re.M):
    params = args_of(src, m.end() - 1)
    METHODS[m.group(1)] = len([p for p in params if not re.match(r'^&?\s*(mut\s+)?self$', p)])
FIELDS = ['props', 'members']
bad, calls, files, literals, imports = 0, 0, set(), 0, []
for d, _, fs in os.walk(root):
    for f in sorted(fs):
        p = os.path.join(d, f)
        if not f.endswith('.rs'): continue
        text = open(p, errors='replace').read()
        rel = os.path.relpath(p, root)
        for name, want in METHODS.items():
            for m in re.finditer(r'\.' + name + r'\s*\(', text):
                calls += 1; files.add(rel)
                got = len(args_of(text, m.end() - 1))
                if got != want:
                    bad += 1; print('%s:%d %s has %d arguments, the definition takes %d' % (rel, text.count('\n', 0, m.start()) + 1, name, got, want))
        if p != own:
            for m in re.finditer(r'\bObjectLiteralDiscriminator\s*\{', text):
                if re.search(r'(struct|for)\s+$', text[max(0, m.start() - 8):m.start()]): continue
                literals += 1
                got = sorted(a.split(':')[0].strip() for a in args_of(text, m.end() - 1))
                if got != sorted(FIELDS):
                    bad += 1; print('%s:%d ObjectLiteralDiscriminator has the fields %s' % (rel, text.count('\n', 0, m.start()) + 1, got))
            for m in re.finditer(r'use\s+crate::checker::\{([^}]*)\}\s*;', text, re.S):
                if re.search(r'\bObjectLiteralDiscriminator\b', m.group(1)): imports.append(rel)
print('%d methods of the file; %d calls in %d files, %d with another argument count or other fields' % (len(METHODS), calls, len(files), bad))
print('ObjectLiteralDiscriminator: %d literals outside the file, imported by %s' % (literals, ', '.join(imports) or 'no file'))
sys.exit(1 if bad else 0)
