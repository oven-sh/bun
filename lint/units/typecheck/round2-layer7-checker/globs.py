#!/usr/bin/env python3
"""Compares the glob re-exports of checker/mod.rs with the modules it declares and with the imports of the crate, by reading.
A glob of a module that exports no `pub` name is an error of the workspace lints (unused_imports, unreachable_pub),
and a `pub` name of two globbed modules is one (ambiguous_glob_reexports).
It reads items that start at column 0, and the names that checker_flags! and define_checker_id! make.
usage: globs.py [--names] [crate directory, default src/typecheck of the worktree]   exit 1 when a line is printed under A, B, C or D
--names also prints G: the names that files import through `crate::checker` and that no globbed module exports."""
import os, re, sys
args = [a for a in sys.argv[1:] if not a.startswith('--')]
crate = args[0] if args else '/workspace/wt/typecheck/src/typecheck'
here = os.path.join(crate, 'checker')
text = open(os.path.join(here, 'mod.rs'), errors='replace').read()
declared = re.findall(r'^pub mod (?:r#)?([A-Za-z_][A-Za-z0-9_]*)\s*;', text, re.M)
globbed = set()
for m in re.finditer(r'^pub use ([^;]+);', text, re.M):
    for g in re.findall(r'(?:self::)?(?:r#)?([A-Za-z_][A-Za-z0-9_]*)::\*', m.group(1)): globbed.add(g)
KINDS = r'(?:(?:const |async |unsafe )*fn|struct|enum|type|const|static(?: mut)?|trait|mod|union)'
ITEM = re.compile(r'^pub ' + KINDS + r' +(?:r#)?([A-Za-z_][A-Za-z0-9_]*)', re.M)
CRATE_ITEM = re.compile(r'^pub\((?:crate|super|in [a-z_:]+)\) (?:' + KINDS + r'|use [^;]*?)\s*(?:r#)?([A-Za-z_][A-Za-z0-9_]*)\s*[;<({:=]', re.M)
PRIVATE = re.compile(r'^' + KINDS + r' +(?:r#)?([A-Za-z_][A-Za-z0-9_]*)', re.M)
FLAGS = re.compile(r'^checker_flags!\(\s*([A-Za-z_][A-Za-z0-9_]*)', re.M)
IDS = re.compile(r'^define_checker_id!\(([^)]*)\)', re.M | re.S)
PUBUSE = re.compile(r'^pub use [^;]*?([A-Za-z_][A-Za-z0-9_]*)\s*;', re.M)
MACRO = re.compile(r'^\s*pub (?:struct|enum|trait|type|fn) \$?([A-Za-z_][A-Za-z0-9_]*)', re.M)
names, crate_names, private, missing = {}, {}, {}, []
for mod in declared:
    path = os.path.join(here, mod + '.rs')
    if not os.path.isfile(path):
        missing.append(mod); continue
    src = open(path, errors='replace').read()
    found = [m.group(1) for m in ITEM.finditer(src)] + [m.group(1) for m in FLAGS.finditer(src)]
    for m in IDS.finditer(src): found += re.findall(r'[A-Za-z_][A-Za-z0-9_]*', m.group(1))
    found += [m.group(1) for m in PUBUSE.finditer(src)]
    names[mod] = found
    crate_names[mod] = [m.group(1) for m in CRATE_ITEM.finditer(src)]
    private[mod] = [m.group(1) for m in PRIVATE.finditer(src)]
bad = False
print(f'{len(declared)} modules declared, {len(declared) - len(missing)} with a file, {len(globbed)} globs')
print('declared, no file:', ' '.join(missing) if missing else 'none')
print('A. glob of a module that has a file and exports no pub name:')
for mod in declared:
    if mod in globbed and mod in names and not names[mod]: print('  ', mod); bad = True
print('B. glob of a name that is not a declared module:')
for g in sorted(globbed - set(declared)): print('  ', g); bad = True
print('C. pub name of two globbed modules:')
seen = {}
for mod in declared:
    if mod in globbed:
        for n in names.get(mod, []): seen.setdefault(n, []).append(mod)
for n, ms in sorted(seen.items()):
    if len(set(ms)) > 1: print('  ', n, ' '.join(sorted(set(ms)))); bad = True
print('D. module with pub names and no glob (its names are not in the namespace of the package):')
for mod in declared:
    if mod not in globbed and names.get(mod): print('  ', mod, len(names[mod]), 'names:', ' '.join(names[mod][:6])); bad = True
print('E. module with a file, no pub name and no glob:')
print('  ', ' '.join(mod for mod in declared if mod not in globbed and mod in names and not names[mod]) or 'none')
print('F. glob of a module that has no file yet:')
print('  ', ' '.join(mod for mod in declared if mod in globbed and mod not in names) or 'none')
if '--names' in sys.argv[1:]:
    exported = set(declared)
    for mod in globbed:
        exported.update(names.get(mod, [])); exported.update(crate_names.get(mod, []))
    # what the macros of c02 and types make at module level is read from the macro bodies
    for mod in globbed:
        path = os.path.join(here, mod + '.rs')
        if os.path.isfile(path):
            src = open(path, errors='replace').read()
            if 'macro_rules!' in src: exported.update(m.group(1) for m in MACRO.finditer(src))
    USE = re.compile(r'\buse\s+crate::checker::((?:\{[^;]*\}|[A-Za-z_][A-Za-z0-9_:]*(?:\s+as\s+\w+)?))\s*;', re.S)
    wanted = {}
    for d, _, files in os.walk(crate):
        for f in files:
            if not f.endswith('.rs'): continue
            p = os.path.join(d, f)
            src = re.sub(r'//[^\n]*', '', open(p, errors='replace').read())
            for m in USE.finditer(src):
                tree = m.group(1).strip()
                if tree.startswith('{'):
                    depth, cur, parts = 0, '', []
                    for ch in tree[1:-1]:
                        if ch == '{': depth += 1
                        if ch == '}': depth -= 1
                        if ch == ',' and depth == 0: parts.append(cur); cur = ''
                        else: cur += ch
                    parts.append(cur)
                else: parts = [tree]
                for part in parts:
                    head = re.match(r'\s*(?:r#)?([A-Za-z_][A-Za-z0-9_]*)', part)
                    if head and head.group(1) != 'self': wanted.setdefault(head.group(1), set()).add(os.path.relpath(p, crate))
    print('G. names imported through crate::checker that no globbed module exports (name, importing files, where a file has it):')
    count = 0
    for n in sorted(wanted):
        if n in exported: continue
        count += 1
        where = [f'pub in {mod} (no glob)' for mod in declared if mod not in globbed and n in names.get(mod, [])]
        where += [f'private in {mod}' for mod in declared if n in private.get(mod, [])]
        print(f'   {n:50} {len(wanted[n]):2} files   {"; ".join(where) if where else "no item of that name at column 0"}')
    print(f'   {count} names of {len(wanted)} imported')
sys.exit(1 if bad else 0)
