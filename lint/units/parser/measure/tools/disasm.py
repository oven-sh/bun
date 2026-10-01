#!/usr/bin/env python3
"""Normalised disassembly of parser functions of a bun-profile binary, one file per function, for `diff -r`.
usage: disasm.py <bun-profile> <out dir> [--match REGEX]
Default REGEX: the type grammar (skip_type_script, skip_typescript, type_sink).
Normalisation: no addresses, no raw bytes; a branch target inside the function becomes L<offset>, a target
outside becomes the demangled symbol without its offset; rip-relative data addresses become <data>."""
import os, re, subprocess, sys, hashlib
binary, outdir = sys.argv[1], sys.argv[2]
rx = re.compile(sys.argv[sys.argv.index('--match') + 1] if '--match' in sys.argv else r'skip_type_?script|skip_typescript|type_sink')
def nm(demangle):
    out = subprocess.run(['llvm-nm', '-S', '--defined-only'] + (['-C'] if demangle else []) + [binary], capture_output=True, text=True, errors='replace').stdout
    d = {}
    for line in out.splitlines():
        m = re.match(r'^([0-9a-f]+) ([0-9a-f]+) (\w) (.*)$', line)
        if m and m.group(3) in 'tTwW': d.setdefault(int(m.group(1), 16), []).append((int(m.group(2), 16), m.group(4)))
    return d
dem = nm(True)
picked = {a: v for a, v in dem.items() if any('bun_js_parser' in n and rx.search(n) for _, n in v)}
os.makedirs(outdir, exist_ok=True)
index = []
for addr in sorted(picked):
    size = max(s for s, _ in picked[addr]); names = sorted(re.sub(r' \(\.llvm\.\d+\)$', '', n) for _, n in picked[addr])
    out = subprocess.run(['llvm-objdump', '-d', '--no-show-raw-insn', '-C', '--no-addresses', f'--start-address={addr}', f'--stop-address={addr + size}', binary], capture_output=True, text=True, errors='replace').stdout
    lines = []
    for line in out.splitlines():
        if not line.startswith('\t') and not line.startswith('  '): continue
        t = line.strip()
        t = re.sub(r' \(\.llvm\.\d+\)', '', t)
        def target(m):
            sym, off = m.group(1), m.group(2)
            if any(sym == n for n in names) or sym in names: return f'<L{off or "+0x0"}>'
            return f'<{sym}>'
        t = re.sub(r'<(.+?)(\+0x[0-9a-f]+)?>$', target, t)
        t = re.sub(r'\b0x[0-9a-f]{5,}\b', '<addr>', t)
        t = re.sub(r'# <addr>.*$', '# <data>', t)
        t = re.sub(r'[-+]?0x[0-9a-f]+\(%rip\)', '<rip>', t)
        t = re.sub(r'^(j\w+|call\w*)\s+[0-9a-f]+ ', r'\1 ', t)
        lines.append(t)
    text = '\n'.join(lines) + '\n'
    fname = re.sub(r'[^A-Za-z0-9_.-]+', '_', names[0])[:150] + '.s'
    with open(os.path.join(outdir, fname), 'w') as f:
        f.write('# ' + '\n# = '.join(names) + f'\n# size {size} instructions {len(lines)}\n' + text)
    index.append((names[0], size, len(lines), hashlib.sha256(text.encode()).hexdigest()[:16], len(names)))
with open(os.path.join(outdir, 'INDEX.txt'), 'w') as f:
    for n, s, k, h, c in sorted(index):
        f.write(f'{s:8} bytes {k:6} insns {h} folded={c} {n}\n')
print(open(os.path.join(outdir, 'INDEX.txt')).read())
