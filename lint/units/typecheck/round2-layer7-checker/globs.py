#!/usr/bin/env python3
"""Compares the glob re-exports of a mod.rs with the modules it declares, by reading.
A glob of a module that exports no `pub` name is an error of the workspace lints (unused_imports, unreachable_pub),
and a `pub` name of two globbed modules is one (ambiguous_glob_reexports).
usage: globs.py [directory of the mod.rs, default src/typecheck/checker of the worktree]   exit 1 when a line is printed under A, B or C"""
import os, re, sys
here = sys.argv[1] if len(sys.argv) > 1 else '/workspace/wt/typecheck/src/typecheck/checker'
text = open(os.path.join(here, 'mod.rs'), errors='replace').read()
declared = re.findall(r'^pub mod (?:r#)?([A-Za-z_][A-Za-z0-9_]*)\s*;', text, re.M)
globbed = set()
for m in re.finditer(r'^pub use ([^;]+);', text, re.M):
    for g in re.findall(r'(?:self::)?(?:r#)?([A-Za-z_][A-Za-z0-9_]*)::\*', m.group(1)): globbed.add(g)
ITEM = re.compile(r'^pub (?:(?:const |async |unsafe )*fn|struct|enum|type|const|static(?: mut)?|trait|mod|union) +(?:r#)?([A-Za-z_][A-Za-z0-9_]*)', re.M)
FLAGS = re.compile(r'^checker_flags!\(\s*([A-Za-z_][A-Za-z0-9_]*)', re.M)
IDS = re.compile(r'^define_checker_id!\(([^)]*)\)', re.M | re.S)
PUBUSE = re.compile(r'^pub use [^;]*?([A-Za-z_][A-Za-z0-9_]*)\s*;', re.M)
names, missing = {}, []
for mod in declared:
    path = os.path.join(here, mod + '.rs')
    if not os.path.isfile(path):
        missing.append(mod); continue
    src = open(path, errors='replace').read()
    found = [m.group(1) for m in ITEM.finditer(src)] + [m.group(1) for m in FLAGS.finditer(src)]
    for m in IDS.finditer(src): found += re.findall(r'[A-Za-z_][A-Za-z0-9_]*', m.group(1))
    found += [m.group(1) for m in PUBUSE.finditer(src)]
    names[mod] = found
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
    if mod not in globbed and names.get(mod): print('  ', mod, len(names[mod]), 'names:', ' '.join(names[mod][:6]))
print('E. module with a file, no pub name and no glob:')
print('  ', ' '.join(mod for mod in declared if mod not in globbed and mod in names and not names[mod]) or 'none')
print('F. glob of a module that has no file yet:')
print('  ', ' '.join(mod for mod in declared if mod in globbed and mod not in names) or 'none')
sys.exit(1 if bad else 0)
