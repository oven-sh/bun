#!/usr/bin/env python3
"""Static audit of src/js_parser against the reference text of a parse without lint (mkref.sh: <dir>/ref).
usage: siteaudit.py [--ref DIR] [--head DIR] [--pred REGEX] [--allow-fn REGEX] [--allow FILE] [--sites] [--max N]
A file that the reference has is SHARED: a parse without lint runs it. Against the reference its diff may hold only
  SITE     an inserted block `if <PRED>[ && ...] {` ... `}`: no line of the reference removed or changed, no `else`,
           balanced braces, the test of the side table first in the condition. With the test false the block does nothing,
           so the text that runs without lint is the text of the reference.
  DECL     inserted `mod x;`, `use ...;`, attribute and comment lines, and the function(s) that --allow-fn names
           (default: the predicate itself, `fn lint`).
  TESTS    an insertion inside a `#[cfg(test)] mod name { ... }` block of the file.
Every other hunk is a VIOLATION: reference text removed or changed, inserted code that is no site, a new function.
--allow FILE: lines `<file regex> <TAB> <regex on the removed or inserted text>` name the accepted exceptions; each prints as EXCEPTION.
A file that the reference lacks is NEW (lint only, or tests): listed with its size and whether a `mod` line reaches it.
Also listed: every read of `starts_for_parse_only` in a shared file that the reference does not have on the same text.
--pred default: (?:p|self)\\.lint\\(\\)        Exit status 1 when a violation is left."""
import os, re, subprocess, sys
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
REF = arg('--ref', '/tmp/costproof/root/ref'); HEAD = arg('--head', '/workspace/wt/parser')
PRED = arg('--pred', r'(?:p|self)\.lint\(\)'); ALLOW_FN = re.compile(arg('--allow-fn', r'^lint$')); MAX = int(arg('--max', '6'))
SITE = re.compile(r'^(\s*)if ' + PRED + r'(?: && .*)? \{\s*$')
allow = []
if arg('--allow', None):
    for line in open(arg('--allow', None)):
        if line.strip() and not line.startswith('#'):
            f, rx = line.rstrip('\n').split('\t', 1); allow.append((re.compile(f), re.compile(rx)))
root = 'src/js_parser'
def files(tree):
    out = set()
    for d, _, fs in os.walk(os.path.join(tree, root)):
        for f in fs:
            if f.endswith('.rs'): out.add(os.path.relpath(os.path.join(d, f), os.path.join(tree, root)))
    return out
fr, fh = files(REF), files(HEAD)
def read(tree, rel): return open(os.path.join(tree, root, rel), errors='replace').read().split('\n')
def hunks(rel):
    out = subprocess.run(['diff', '-U0', os.path.join(REF, root, rel), os.path.join(HEAD, root, rel)], capture_output=True, text=True, errors='replace').stdout
    res = []; cur = None
    for line in out.split('\n'):
        m = re.match(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', line)
        if m:
            cur = {'old': int(m.group(1)), 'nold': int(m.group(2) or 1), 'new': int(m.group(3)), 'nnew': int(m.group(4) or 1), 'minus': [], 'plus': []}
            res.append(cur); continue
        if cur is None: continue
        if line.startswith('-') and not line.startswith('---'): cur['minus'].append(line[1:])
        elif line.startswith('+') and not line.startswith('+++'): cur['plus'].append(line[1:])
    return res
def enclosing_fn(lines, ln):
    for i in range(ln - 1, -1, -1):
        m = re.match(r'^\s*(?:pub(?:\([a-z]+\))? )?(?:const )?(?:unsafe )?fn (\w+)', lines[i])
        if m: return m.group(1)
    return '-'
def test_ranges(lines):
    # inline test modules: `#[cfg(test)]` then `mod name {` up to the `}` of the same indent (1-based, inclusive)
    out = []
    for i, l in enumerate(lines):
        if l.strip() != '#[cfg(test)]': continue
        j = i + 1
        while j < len(lines) and lines[j].strip().startswith('#['): j += 1
        m = re.match(r'^(\s*)(?:pub(?:\([a-z]+\))? )?mod \w+ \{\s*$', lines[j]) if j < len(lines) else None
        if not m: continue
        k = j + 1
        while k < len(lines) and lines[k] != m.group(1) + '}': k += 1
        out.append((i + 1, k + 1))
    return out
def is_plain(l):
    s = l.strip()
    return s == '' or s.startswith('//') or s.startswith('#[') or s.startswith('#![')
def classify(plus):
    code = [l for l in plus if not (l.strip() == '' or l.strip().startswith('//'))]
    if not code: return 'DECL', 'comment'
    if all(re.match(r'^\s*(pub(\([a-z]+\))? )?(mod \w+;|use [^;{]*(\{[^}]*\})?;)\s*$', l) or is_plain(l) for l in code): return 'DECL', 'mod/use'
    if SITE.match(code[0]):
        # one or more `if <PRED> { ... }` blocks, each closed at the indent it opened at, none with an `else`
        i = 0; heads = []
        while i < len(code):
            m = SITE.match(code[i])
            if not m: return 'VIOLATION', 'a site followed by inserted code that is not a site'
            ind = m.group(1); depth = 0; j = i
            while j < len(code):
                depth += code[j].count('{') - code[j].count('}')
                if depth <= 0: break
                j += 1
            if j >= len(code) or depth != 0 or code[j] != ind + '}' or any(re.search(r'\}\s*else\b', l) for l in code[i:j + 1]):
                return 'VIOLATION', 'a block that starts as a site and is not one `if` block without `else`'
            heads.append(code[i].strip()); i = j + 1
        return 'SITE', heads
    # whole new functions: every fn of the block is allowed by name
    text = '\n'.join(code)
    fns = re.findall(r'^\s*(?:pub(?:\([a-z]+\))? )?(?:const )?(?:unsafe )?fn (\w+)', text, re.M)
    if fns and all(ALLOW_FN.search(f) for f in fns) and text.count('{') == text.count('}'): return 'DECL', 'fn ' + ' '.join(fns)
    if fns: return 'VIOLATION', 'new function in a shared file: ' + ' '.join(fns)
    return 'VIOLATION', 'inserted code that is not a site'
def allowed(rel, text):
    return any(f.search(rel) and rx.search(text) for f, rx in allow)
viol = 0; sites = []; summary = []
for rel in sorted(fr - fh): print('VIOLATION  %s: the reference has the file, the tree does not' % rel); viol += 1
for rel in sorted(fr & fh):
    ref_lines, head_lines = read(REF, rel), read(HEAD, rel)
    tests = test_ranges(head_lines)
    n = {'SITE': 0, 'DECL': 0, 'TESTS': 0, 'VIOLATION': 0, 'EXCEPTION': 0}
    for h in hunks(rel):
        if not h['minus'] and any(a <= h['new'] and h['new'] + h['nnew'] - 1 <= b for a, b in tests): n['TESTS'] += 1; continue
        if h['minus']:
            kind, why = 'VIOLATION', 'reference text removed or changed (%d lines out, %d in)' % (len(h['minus']), len(h['plus']))
        else:
            kind, why = classify(h['plus'])
        if kind == 'VIOLATION' and allowed(rel, '\n'.join(h['minus'] + h['plus'])): kind = 'EXCEPTION'
        n[kind] += len(why) if kind == 'SITE' else 1
        if kind == 'SITE':
            for text in why: sites.append((rel, h['new'], enclosing_fn(head_lines, h['new']), len(h['plus']), text))
        if kind in ('VIOLATION', 'EXCEPTION'):
            if kind == 'VIOLATION': viol += 1
            if n[kind] <= MAX:
                print('%-9s  %s:%d  [%s]  %s' % (kind, rel, h['new'], enclosing_fn(head_lines, h['new']), why))
                for l in h['minus'][:2]: print('             - ' + l.strip()[:120])
                for l in h['plus'][:2]: print('             + ' + l.strip()[:120])
    # reads of the option outside the reference's own
    a = sorted(l.strip() for l in ref_lines if 'starts_for_parse_only' in l)
    b = sorted(l.strip() for i, l in enumerate(head_lines) if 'starts_for_parse_only' in l and not any(x <= i + 1 <= y for x, y in tests))
    extra = list(b)
    for l in a:
        if l in extra: extra.remove(l)
    if any(n.values()) or extra: summary.append((rel, n, len(extra)))
print()
print('%-36s %6s %6s %6s %10s %10s %s' % ('shared file', 'sites', 'decl', 'tests', 'exception', 'VIOLATION', 'reads of starts_for_parse_only that the reference lacks'))
for rel, n, extra in summary: print('%-36s %6d %6d %6d %10d %10d %d' % (rel, n['SITE'], n['DECL'], n['TESTS'], n['EXCEPTION'], n['VIOLATION'], extra))
same = [rel for rel in sorted(fr & fh) if rel not in [s[0] for s in summary]]
print('%d shared files equal the reference' % len(same))
mods = ''
for rel in fh:
    try: mods += open(os.path.join(HEAD, root, rel), errors='replace').read()
    except OSError: pass
print()
for rel in sorted(fh - fr):
    stem = os.path.basename(rel)[:-3]
    reached = bool(re.search(r'\bmod ' + re.escape(stem) + r'\b', mods)) or ('"' + os.path.basename(rel) + '"') in mods
    print('NEW        %-40s %6d lines  %s' % (rel, len(read(HEAD, rel)), 'reached by a mod line' if reached else 'NO mod line reaches it'))
if '--sites' in sys.argv:
    print()
    for rel, ln, fn, k, text in sites: print('SITE  %s:%d  [%s]  %d lines  %s' % (rel, ln, fn, k, text[:100]))
print()
print('%d sites, %d violations' % (len(sites), viol))
print('PASS' if viol == 0 else 'FAIL')
sys.exit(1 if viol else 0)
