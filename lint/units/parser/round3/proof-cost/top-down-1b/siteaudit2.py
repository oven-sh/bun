#!/usr/bin/env python3
"""Static audit of src/js_parser (and of src/ast/ts.rs) against the reference text of a parse without lint.
usage: siteaudit2.py [--ref DIR] [--head DIR] [--pred REGEX] [--allow-fn REGEX] [--allow FILE] [--else] [--sites] [--max N]
                     [--ast-base COMMIT [--repo DIR]]
The reference is the tree of mkref.sh (<dir>/ref): main + the sink form + the boxed tables + Metadata::MDot in the arena.
A file that the reference has is SHARED: a parse without lint runs it. Lines are compared without their indentation.
Against the reference a shared file may hold only
  SITE       inserted lines `if <PRED>[ && ...] {` ... `}`: no line of the reference removed or changed, braces balanced,
             the test of the side table first in the condition, no `else` arm of that `if`. The condition may be broken
             over lines as rustfmt does. With the test false the block does nothing: the text that runs is the reference.
  SITE-ELSE  (only with --else) inserted `if <PRED>[ && ...] {` ... `} else {` before lines of the reference and an inserted
             `}` after them, at the indentation of the `if`: with the test false the lines of the reference run.
  DECL       inserted `mod x;`, `use ...;`, attribute and comment lines, and the function(s) that --allow-fn names
             (default: the predicate itself, `fn lint`).
  TESTS      an insertion inside a `#[cfg(test)] mod name { ... }` block of the file.
Every other hunk is a VIOLATION. --allow FILE: lines `<file regex> <TAB> <regex on the removed or inserted text>` name
accepted exceptions; each prints as EXCEPTION.
A file that the reference lacks is NEW (lint only, or tests): listed with its size and whether a `mod` line reaches it.
--ast-base COMMIT: src/ast/ts.rs of the tree must be that file at COMMIT with Metadata::MDot as a StoreSlice<Ref> and the
lines that declare the type nodes; every other difference is a VIOLATION (it changes what a parse without lint emits).
--pred default: (?:p|self)\\.lint\\(\\)        Exit status 1 when a violation is left."""
import os, re, subprocess, sys, difflib
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
REF = arg('--ref', '/tmp/costproof/root/ref'); HEAD = arg('--head', '/workspace/wt/parser')
PRED = arg('--pred', r'(?:p|self)\.lint\(\)'); ALLOW_FN = re.compile(arg('--allow-fn', r'^lint$')); MAX = int(arg('--max', '6'))
ELSE_OK = '--else' in sys.argv
HEADRX = re.compile(r'^if ' + PRED + r'(?=\s|$)')
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
def hunks(a, b):
    # insertions and replacements of b against a, compared without indentation: (line in b, removed lines, inserted lines)
    sa = [l.strip() for l in a]; sb = [l.strip() for l in b]
    res = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, sa, sb, autojunk=False).get_opcodes():
        if tag == 'equal': continue
        res.append({'new': j1 + 1, 'minus': a[i1:i2], 'plus': b[j1:j2]})
    return res
def enclosing_fn(lines, ln):
    for i in range(min(ln, len(lines)) - 1, -1, -1):
        m = re.match(r'^\s*(?:pub(?:\([a-z]+\))? )?(?:const )?(?:unsafe )?fn (\w+)', lines[i])
        if m: return m.group(1)
    return '-'
def test_ranges(lines):
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
def strip_strings(s):
    # braces inside string and char literals do not count
    s = re.sub(r'b?"(?:[^"\\]|\\.)*"', '""', s)
    return re.sub(r"b?'(?:[^'\\]|\\.)'", "''", s)
def classify(plus):
    """-> (kind, detail). kind: DECL, SITE, OPEN (a site that ends in `} else {`), CLOSE (one `}`), VIOLATION."""
    code = [l for l in plus if not (l.strip() == '' or l.strip().startswith('//'))]
    if not code: return 'DECL', 'comment'
    if all(re.match(r'^\s*(pub(\([a-z]+\))? )?(mod \w+;|use [^;{]*(\{[^}]*\})?;)\s*$', l) or is_plain(l) for l in code): return 'DECL', 'mod/use'
    if len(code) == 1 and code[0].strip() == '}': return 'CLOSE', code[0][:len(code[0]) - len(code[0].lstrip())]
    if HEADRX.match(code[0].strip()):
        i = 0; heads = []
        while i < len(code):
            if not HEADRX.match(code[i].strip()): return 'VIOLATION', 'a site followed by inserted code that is not a site'
            ind = code[i][:len(code[i]) - len(code[i].lstrip())]; depth = 0; j = i; opened = False
            while j < len(code):
                t = strip_strings(code[j])
                if opened and depth == 1 and re.match(r'^\s*\}\s*else\b', t):
                    if ELSE_OK and j == len(code) - 1 and t.strip() == '} else {' and code[j].startswith(ind + '}'):
                        heads.append(code[i].strip()); return 'OPEN', (heads, ind)
                    return 'VIOLATION', 'the `if` of a site has an `else` arm'
                depth += t.count('{') - t.count('}')
                if '{' in t: opened = True
                if opened and depth <= 0: break
                j += 1
            if j >= len(code) or depth != 0 or code[j].rstrip() != ind + '}':
                return 'VIOLATION', 'a block that starts as a site and is not closed at the indentation of its `if`'
            heads.append(code[i].strip()); i = j + 1
        return 'SITE', heads
    text = '\n'.join(code)
    fns = re.findall(r'^\s*(?:pub(?:\([a-z]+\))? )?(?:const )?(?:unsafe )?fn (\w+)', text, re.M)
    if fns and all(ALLOW_FN.search(f) for f in fns) and text.count('{') == text.count('}'): return 'DECL', 'fn ' + ' '.join(fns)
    if fns: return 'VIOLATION', 'new function in a shared file: ' + ' '.join(fns)
    return 'VIOLATION', 'inserted code that is not a site'
def allowed(rel, text): return any(f.search(rel) and rx.search(text) for f, rx in allow)
viol = 0; sites = []; summary = []
def report(kind, rel, ln, fn, why, minus, plus, n):
    if n <= MAX:
        print('%-9s  %s:%d  [%s]  %s' % (kind, rel, ln, fn, why))
        for l in minus[:2]: print('             - ' + l.strip()[:120])
        for l in plus[:2]: print('             + ' + l.strip()[:120])
for rel in sorted(fr - fh): print('VIOLATION  %s: the reference has the file, the tree does not' % rel); viol += 1
for rel in sorted(fr & fh):
    ref_lines, head_lines = read(REF, rel), read(HEAD, rel)
    tests = test_ranges(head_lines)
    n = {'SITE': 0, 'SITE-ELSE': 0, 'DECL': 0, 'TESTS': 0, 'VIOLATION': 0, 'EXCEPTION': 0}
    pending = None     # an OPEN site that waits for its closing brace
    for h in hunks(ref_lines, head_lines):
        ln = h['new']; fn = enclosing_fn(head_lines, ln)
        if not h['minus'] and any(a <= ln and ln + len(h['plus']) - 1 <= b for a, b in tests): n['TESTS'] += 1; continue
        if h['minus']: kind, why = 'VIOLATION', 'reference text removed or changed (%d lines out, %d in)' % (len(h['minus']), len(h['plus']))
        else: kind, why = classify(h['plus'])
        if kind == 'CLOSE':
            if pending and pending[1] == why:
                for text in pending[0]: sites.append((rel, pending[2], pending[3], 'SITE-ELSE', text))
                n['SITE-ELSE'] += len(pending[0]); pending = None; continue
            kind, why = 'VIOLATION', 'an inserted `}` that closes no site'
        if pending:
            k2, w2 = 'VIOLATION', 'a site that ends in `} else {` and is not closed by an inserted `}` at its indentation'
            if not allowed(rel, pending[4]): viol += 1; n['VIOLATION'] += 1; report('VIOLATION', rel, pending[2], pending[3], w2, [], pending[4].split('\n'), n['VIOLATION'])
            else: n['EXCEPTION'] += 1
            pending = None
        if kind == 'OPEN': pending = (why[0], why[1], ln, fn, '\n'.join(h['plus'])); continue
        if kind == 'VIOLATION' and allowed(rel, '\n'.join(h['minus'] + h['plus'])): kind = 'EXCEPTION'
        if kind == 'SITE':
            n['SITE'] += len(why)
            for text in why: sites.append((rel, ln, fn, 'SITE', text))
            continue
        n[kind] += 1
        if kind == 'VIOLATION': viol += 1
        if kind in ('VIOLATION', 'EXCEPTION'): report(kind, rel, ln, fn, why, h['minus'], h['plus'], n[kind])
    if pending:
        viol += 1; n['VIOLATION'] += 1; report('VIOLATION', rel, pending[2], pending[3], 'a site that ends in `} else {` and is never closed', [], pending[4].split('\n'), n['VIOLATION'])
    a = sorted(l.strip() for l in ref_lines if 'starts_for_parse_only' in l)
    b = sorted(l.strip() for i, l in enumerate(head_lines) if 'starts_for_parse_only' in l and not any(x <= i + 1 <= y for x, y in tests))
    extra = list(b)
    for l in a:
        if l in extra: extra.remove(l)
    if any(n.values()) or extra: summary.append((rel, n, len(extra)))
print()
print('%-36s %6s %9s %6s %6s %10s %10s %s' % ('shared file', 'sites', 'site-else', 'decl', 'tests', 'exception', 'VIOLATION', 'reads of starts_for_parse_only that the reference lacks'))
for rel, n, extra in summary: print('%-36s %6d %9d %6d %6d %10d %10d %d' % (rel, n['SITE'], n['SITE-ELSE'], n['DECL'], n['TESTS'], n['EXCEPTION'], n['VIOLATION'], extra))
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
ast = arg('--ast-base', None)
if ast:
    repo = arg('--repo', HEAD)
    want = subprocess.run(['git', '-C', repo, 'show', ast + ':src/ast/ts.rs'], capture_output=True, text=True).stdout.split('\n')
    try: have = open(os.path.join(HEAD, 'src/ast/ts.rs'), errors='replace').read().split('\n')
    except OSError: have = None
    print()
    k = 0
    if have is None: print('src/ast/ts.rs: not in the tree, not audited')
    for h in (hunks(want, have) if have is not None else []):
        text = '\n'.join(h['minus'] + h['plus'])
        ok = (not h['minus'] and all(re.match(r'^\s*(#\[path = "\w+\.rs"\]|(pub )?mod \w+;|pub use \w+::\*;|)\s*$', l) for l in h['plus'])) \
            or ('MDot(' in text and all(('MDot' in l) or l.strip().startswith('//') or l.strip() == '' for l in h['minus'] + h['plus']))
        if ok: print('DECL       src/ast/ts.rs:%d  %s' % (h['new'], (h['plus'] or h['minus'])[0].strip()[:100])); continue
        k += 1; viol += 1
        if k <= MAX:
            print('VIOLATION  src/ast/ts.rs:%d  [%s]  differs from %s (%d lines out, %d in)' % (h['new'], enclosing_fn(have, h['new']), ast, len(h['minus']), len(h['plus'])))
            for l in h['minus'][:2]: print('             - ' + l.strip()[:120])
            for l in h['plus'][:2]: print('             + ' + l.strip()[:120])
    if have is not None: print('src/ast/ts.rs: %d violations' % k)
if '--sites' in sys.argv:
    print()
    for rel, ln, fn, kind, text in sites: print('%-9s  %s:%d  [%s]  %s' % (kind, rel, ln, fn, text[:100]))
print()
print('%d sites, %d violations' % (len(sites), viol))
print('PASS' if viol == 0 else 'FAIL')
sys.exit(1 if viol else 0)
