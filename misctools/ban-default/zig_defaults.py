#!/usr/bin/env python3
"""Heuristic: Rust structs that #[derive(Default)] whose Zig original gave a field a non-zero default."""
import os, re, sys, json, collections

RS_ROOT = '/workspace/bun/src'
ZIG_ROOT = '/tmp/zig-ref/src'

def strip_comments(s):
    # remove // line comments (naive: not inside strings) and /* */ blocks
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    out = []
    for line in s.split('\n'):
        # naive string-aware strip
        i = 0; in_str = False; res = line
        while i < len(line) - 1:
            c = line[i]
            if c == '"' and (i == 0 or line[i-1] != '\\'): in_str = not in_str
            elif not in_str and c == '/' and line[i+1] == '/':
                res = line[:i]; break
            i += 1
        out.append(res)
    return '\n'.join(out)

def match_brace(s, i):
    """s[i] == '{' -> index of matching '}'"""
    depth = 0
    n = len(s)
    j = i
    while j < n:
        c = s[j]
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: return j
        elif c == '"':
            j += 1
            while j < n and s[j] != '"':
                if s[j] == '\\': j += 1
                j += 1
        j += 1
    return -1

def split_top(body, sep=','):
    parts = []; depth = 0; cur = []
    i = 0; n = len(body)
    while i < n:
        c = body[i]
        if c in '([{<' : depth += 1 if c != '<' else 0
        elif c in ')]}': depth -= 1
        if c == '"':
            cur.append(c); i += 1
            while i < n and body[i] != '"':
                if body[i] == '\\': cur.append(body[i]); i += 1
                cur.append(body[i]); i += 1
            if i < n: cur.append(body[i])
            i += 1; continue
        if c == sep and depth == 0:
            parts.append(''.join(cur)); cur = []
        else:
            cur.append(c)
        i += 1
    if cur: parts.append(''.join(cur))
    return parts

# ---- Zig index: struct name -> list of (file, {field: (type, default)})
zig_structs = collections.defaultdict(list)
zig_re = re.compile(r'(?:pub\s+)?const\s+(\w+)\s*=\s*(?:packed\s+|extern\s+)?struct\s*(?:\([^)]*\)\s*)?\{')
fn_ret_struct = re.compile(r'return\s+(?:packed\s+|extern\s+)?struct\s*\{')
def parse_zig_fields(body):
    # remove nested decl bodies (fn ... { }, const X = struct { }) by only considering depth-0 text
    flat = []; depth = 0
    i = 0; n = len(body)
    while i < n:
        c = body[i]
        if c == '"':
            j = i + 1
            while j < n and body[j] != '"':
                if body[j] == '\\': j += 1
                j += 1
            if depth == 0: flat.append(body[i:j+1])
            i = j + 1; continue
        if c == '{':
            depth += 1
            if depth == 1: flat.append('{')
        elif c == '}':
            depth -= 1
            if depth == 0: flat.append('}')
        elif depth == 0:
            flat.append(c)
        i += 1
    flat = ''.join(flat)
    fields = {}
    for part in split_top(flat):
        part = part.strip()
        # drop leading decls ending with ; or }
        # field form: name: Type = default   (may be preceded by junk from decls)
        m = re.search(r'(?:^|[;}\n])\s*(?:comptime\s+)?(@"[^"]+"|\w+)\s*:\s*([^=;]+?)(?:\s*=\s*([^;]+))?\s*$', part, flags=re.S)
        if not m: continue
        name = m.group(1).strip('@"')
        if name in ('pub','const','fn','var','usingnamespace'): continue
        fields[name] = (m.group(2).strip(), m.group(3).strip() if m.group(3) else None)
    return fields

for dp, dn, fn in os.walk(ZIG_ROOT):
    for f in fn:
        if not f.endswith('.zig'): continue
        p = os.path.join(dp, f)
        try: s = strip_comments(open(p, encoding='utf-8', errors='replace').read())
        except Exception: continue
        rel = os.path.relpath(p, ZIG_ROOT)
        for m in zig_re.finditer(s):
            i = m.end() - 1
            j = match_brace(s, i)
            if j < 0: continue
            fields = parse_zig_fields(s[i+1:j])
            if fields:
                zig_structs[m.group(1)].append((rel, fields))
        # file-as-struct: top-level fields
        top = parse_zig_fields(s)
        if top:
            base = os.path.splitext(f)[0]
            zig_structs[base].append((rel, top))

ZEROISH = re.compile(r'^(false|0|0\.0|null|""|\.\{\}|&\.\{\}|undefined|&\[_\]u8\{\}|\.empty|\.none|\.None|\.init\(.*\)|\.\{\s*\}|0x0+|\.zero|\.invalid|\.unset|&\[_\].*\{\}|\.initEmpty\(\)|\.initial|std\.mem\.zeroes\(.*\)|@splat\(0\)|bun\.invalid_fd|\.\{\s*\.\w+\s*=\s*\{\}\s*\}|"")$')

# ---- Rust derive(Default) structs
rs_re = re.compile(r'#\[derive\(([^)]*\bDefault\b[^)]*)\)\]\s*((?:#\[[^\]]*\]\s*)*)(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)\s*(<[^{;(]*>)?\s*(?:where[^{]*)?\{', re.S)
findings = []
n_structs = 0; n_matched = 0
for dp, dn, fn in os.walk(RS_ROOT):
    for f in fn:
        if not f.endswith('.rs'): continue
        p = os.path.join(dp, f)
        raw = open(p, encoding='utf-8', errors='replace').read()
        s = strip_comments(raw)
        rel = os.path.relpath(p, RS_ROOT)
        for m in rs_re.finditer(s):
            n_structs += 1
            name = m.group(3)
            i = m.end() - 1
            j = match_brace(s, i)
            if j < 0: continue
            body = s[i+1:j]
            rfields = {}
            for part in split_top(body):
                part = re.sub(r'#\[[^\]]*\]', '', part).strip()
                mm = re.match(r'(?:pub(?:\([^)]*\))?\s+)?(r#)?(\w+)\s*:\s*(.+)$', part, flags=re.S)
                if mm: rfields[mm.group(2)] = ' '.join(mm.group(3).split())
            cands = zig_structs.get(name, [])
            if not cands: continue
            # prefer same path
            zrel_guess = os.path.splitext(rel)[0] + '.zig'
            def score(c):
                zrel, zf = c
                common = len(set(zf) & set(rfields))
                return (zrel == zrel_guess, os.path.dirname(zrel) == os.path.dirname(rel), common)
            best = max(cands, key=score)
            zrel, zf = best
            common = set(zf) & set(rfields)
            if len(common) < max(1, min(len(rfields), len(zf)) // 2): continue
            n_matched += 1
            line = raw[:raw.find(m.group(0)[:40])].count('\n') + 1 if m.group(0)[:40] in raw else 0
            for fname in sorted(common):
                ztype, zdef = zf[fname]
                if zdef is None:
                    findings.append({'kind': 'zig-required', 'rs': rel, 'struct': name, 'field': fname, 'rs_type': rfields[fname], 'zig': zrel, 'zig_type': ztype, 'zig_default': None})
                elif not ZEROISH.match(zdef):
                    findings.append({'kind': 'zig-nonzero', 'rs': rel, 'struct': name, 'field': fname, 'rs_type': rfields[fname], 'zig': zrel, 'zig_type': ztype, 'zig_default': zdef[:120]})
print('rust derive(Default) structs:', n_structs, 'matched to zig:', n_matched, file=sys.stderr)
json.dump(findings, open('/tmp/audit/zig_default_candidates.json', 'w'), indent=1)
c = collections.Counter(f['kind'] for f in findings)
print(c, file=sys.stderr)
for f in findings:
    if f['kind'] == 'zig-nonzero':
        print(f"{f['rs']}: {f['struct']}.{f['field']}: {f['rs_type']}   zig default = {f['zig_default']}   ({f['zig']})")
