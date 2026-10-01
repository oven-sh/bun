# Stand-ins for the callees of the mounted files: the signature of a callee that the tree defines is copied from the tree, the others come from stubs/checker_stub_template.rs. usage: gen.py <harness dir> <work dir>
import re, os, sys
HERE, W = sys.argv[1], sys.argv[2]
CK = '/workspace/wt/typecheck/src/typecheck/checker'
mine = "c11_check_variables_decorators.rs c12_iteration_types.rs c15_calls.rs c17_unary_meta_yield.rs c47_promised_mapped_template.rs c48_contextual_types.rs c49_call_arguments_decorator_signatures.rs c51_type_facts_awaited.rs jsx.rs".split()
text = {f: open(os.path.join(CK, f)).read() for f in os.listdir(CK) if f.endswith('.rs')}

def fn_span(src, start):
    # start: index of 'fn'. returns (sig_text, body_end_index)
    i = start
    depth = 0
    n = len(src)
    while i < n:
        ch = src[i]
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        elif ch == '{' and depth == 0:
            break
        elif ch == ';' and depth == 0:
            return src[start:i], i
        i += 1
    sig = src[start:i]
    # find matching brace
    d = 0
    j = i
    while j < n:
        if src[j] == '{':
            d += 1
        elif src[j] == '}':
            d -= 1
            if d == 0:
                break
        j += 1
    return sig, j + 1

def strip_strings_comments(s):
    # blank out string literal contents and line comments to keep brace matching sane
    out = []
    i = 0
    n = len(s)
    while i < n:
        if s.startswith('//', i):
            j = s.find('\n', i)
            if j < 0: j = n
            out.append(' ' * (j - i)); i = j; continue
        ch = s[i]
        if ch == '"':
            j = i + 1
            while j < n and s[j] != '"':
                if s[j] == '\\': j += 1
                j += 1
            out.append('"' + ' ' * (j - i - 1) + '"'); i = j + 1; continue
        if ch == "'" and i + 2 < n:
            # char literal or lifetime
            m = re.match(r"'(\\.|[^\\'])'", s[i:i+4])
            if m:
                out.append("'" + ' ' * (len(m.group(0)) - 2) + "'"); i += len(m.group(0)); continue
        out.append(ch); i += 1
    return ''.join(out)

clean = {f: strip_strings_comments(t) for f, t in text.items()}

# methods of Checker and free fns defined in the tree outside my files
methods = {}  # name -> (file, sig)
frees = {}
for f, s in clean.items():
    if f in mine or f in "c01_data.rs c02_program_checker.rs types.rs mapper.rs links.rs stringer_generated.rs".split(): continue
    orig = text[f]
    # impl blocks for Checker
    spans = []
    for m in re.finditer(r'\bimpl\s*<\s*\'a\s*>\s*Checker\s*<\s*\'a\s*>\s*\{', s):
        i = m.end(); d = 1
        while i < len(s) and d > 0:
            if s[i] == '{': d += 1
            elif s[i] == '}': d -= 1
            i += 1
        spans.append((m.end(), i))
    for fm in re.finditer(r'\bfn\s+([a-z_0-9]+)\b', s):
        pos = fm.start()
        sig, _ = fn_span(s, pos)
        sig_orig = orig[pos:pos + len(sig)]
        in_impl = any(a <= pos < b for a, b in spans)
        # top-level item only: previous non-space chars on line should be pub/pub(crate) or nothing
        line_start = s.rfind('\n', 0, pos) + 1
        prefix = s[line_start:pos].strip()
        indent = pos - line_start - len(s[line_start:pos].lstrip()) if False else len(s[line_start:pos]) - len(s[line_start:pos].lstrip())
        if in_impl and indent == 4:
            methods.setdefault(fm.group(1), (f, sig_orig.strip()))
        elif indent == 0 and not in_impl:
            frees.setdefault(fm.group(1), (f, sig_orig.strip()))

real_model = "c01_data.rs c02_program_checker.rs types.rs mapper.rs links.rs stringer_generated.rs".split()
mounted = {}
for f in mine:
    if f.startswith('c11') or f.startswith('c47'):
        continue
    mounted[f] = text[f]
for f in real_model:
    mounted[f] = text[f]
mounted['c11_part.rs'] = open(W + '/c11_part.rs').read()
mounted['c47_part.rs'] = open(W + '/c47_part.rs').read()
mclean = {f: strip_strings_comments(t) for f, t in mounted.items()}
defined_mine = set()
for f in mclean:
    defined_mine |= set(re.findall(r'\bfn (\w+)\b', mclean[f]))
called = set()
for f in mclean:
    for m in re.finditer(r'\b(?:self|c)\s*\.\s*(\w+)\s*\(', mclean[f]):
        called.add(m.group(1))
ext = sorted(n for n in called if n not in defined_mine)
have = [n for n in ext if n in methods]
missing = [n for n in ext if n not in methods]
out = ["// Generated: signatures copied from the files of the tree, bodies left out.", "#![allow(unused_variables, unused_mut, unused_imports)]", "use super::*;", "use crate::ast::*;", "use crate::core::{List, LiveList, Map, Text};", "use crate::diagnostics::MessageId;", "use crate::jsnum::Number;", "impl<'a> Checker<'a> {"]
for n in have:
    f, sig = methods[n]
    out.append("    // %s" % f)
    out.append("    pub " + sig.replace('pub ', '', 1) if sig.startswith('pub ') else "    pub " + sig)
    out[-1] = "    " + (sig if sig.startswith('pub') else 'pub ' + sig) + " { todo!() }"
out.append("}")
open(W + '/auto_stubs.rs', 'w').write('\n'.join(out) + '\n')
open(W + '/missing_methods.txt', 'w').write('\n'.join(missing) + '\n')
# free fns used by my files (imported from crate::checker)
imported = set()
for f in mounted:
    for m in re.finditer(r'use crate::checker::\{([^}]*)\};', mounted[f], re.S):
        for n in m.group(1).split(','):
            n = n.strip()
            if n and n[0].islower():
                imported.add(n)
fr = ["// Generated: free functions of the tree that my files import.", "#![allow(unused_variables, unused_mut, unused_imports)]", "use super::*;", "use crate::ast::*;", "use crate::core::{List, LiveList, Map, Text};", "use crate::diagnostics::MessageId;", "use crate::jsnum::Number;"]
miss_free = []
for n in sorted(imported):
    if n in defined_mine: continue
    if n in frees:
        f, sig = frees[n]
        fr.append("// %s" % f)
        fr.append((sig if sig.startswith('pub') else 'pub ' + sig) + " { todo!() }")
    else:
        miss_free.append(n)
open(W + '/auto_free.rs', 'w').write('\n'.join(fr) + '\n')
open(W + '/missing_free.txt', 'w').write('\n'.join(miss_free) + '\n')
print(len(have), "auto method stubs;", len(missing), "missing methods;", len(miss_free), "missing free fns:", miss_free)

# methods of the Checker and free functions that the mounted files define themselves
mounted_methods, mounted_frees = set(), set()
for f, s in mclean.items():
    spans = []
    for m in re.finditer(r"\bimpl\s*<\s*'a\s*>\s*Checker\s*<\s*'a\s*>\s*\{", s):
        i = m.end(); d = 1
        while i < len(s) and d > 0:
            if s[i] == '{': d += 1
            elif s[i] == '}': d -= 1
            i += 1
        spans.append((m.end(), i))
    for fm in re.finditer(r'\bfn\s+([a-z_0-9]+)\b', s):
        pos = fm.start()
        line_start = s.rfind('\n', 0, pos) + 1
        indent = len(s[line_start:pos]) - len(s[line_start:pos].lstrip())
        in_impl = any(a <= pos < b for a, b in spans)
        if in_impl and indent == 4:
            mounted_methods.add(fm.group(1))
        elif indent == 0 and not in_impl:
            mounted_frees.add(fm.group(1))
# hand stubs yield to definitions that landed in the tree
tpl = open(HERE + '/stubs/checker_stub_template.rs').read().split('\n')
kept = []
dropped = []
for line in tpl:
    m = re.match(r'\s*pub fn (\w+)\b.*\}\s*$', line)
    if m and line.startswith('    ') and (m.group(1) in methods or m.group(1) in mounted_methods):
        dropped.append(m.group(1)); continue
    m2 = re.match(r'pub fn (\w+)\b.*\}\s*$', line)
    if m2 and (m2.group(1) in frees or m2.group(1) in mounted_frees):
        dropped.append(m2.group(1)); continue
    kept.append(line)
open(W + '/checker_stub.rs', 'w').write('\n'.join(kept))
print("hand stubs dropped (now in tree):", dropped)
