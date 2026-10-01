#!/usr/bin/env python3
"""Normalised disassembly of the bun_js_parser functions of a bun-profile binary, to compare two builds.
usage: fnasm.py <bun-profile> <out.json> [--match REGEX]
One objdump pass over the address span of the selected symbols. Addresses are removed: a branch inside the
function is <.+off>, a call or jump to another symbol <name+off>, a data address <name+off> or <abs>.
A symbol that shares its address with others (identical code folding) is named by the smallest of the names.
The " (.llvm.N)" suffix of a symbol that ThinLTO promoted is cut."""
import re, subprocess, sys, json, hashlib
binary, out = sys.argv[1], sys.argv[2]
rx = re.compile(sys.argv[sys.argv.index('--match') + 1]) if '--match' in sys.argv else re.compile(r'bun_js_parser')
cut = lambda n: re.sub(r' \(\.llvm\.\d+\)', '', n)
run = lambda *a: subprocess.run(a, capture_output=True, text=True, errors='replace').stdout
syms = {}; at = {}; names = {}
for line in run('llvm-nm', '-S', '--defined-only', '-C', binary).splitlines():
    m = re.match(r'^([0-9a-f]+) ([0-9a-f]+) (\w) (.*)$', line)
    if not m or m.group(3) not in 'tTwW': continue
    a = int(m.group(1), 16); name = cut(m.group(4))
    at.setdefault(a, []).append(name); names[name] = a
    if 'bun_js_parser' in name and rx.search(name):
        e = syms.setdefault(a, [0, []]); e[0] = max(e[0], int(m.group(2), 16)); e[1].append(name)
canon = lambda n: min(at[names[n]]) if n in names else n
seg = [(int(m.group(1), 16), int(m.group(1), 16) + int(m.group(2), 16)) for m in re.finditer(
    r'^\s*LOAD\s+0x[0-9a-f]+\s+0x([0-9a-f]+)\s+0x[0-9a-f]+\s+0x[0-9a-f]+\s+0x([0-9a-f]+)', run('llvm-readelf', '-lW', binary), re.M)]
lo = min(syms); hi = max(a + s for a, (s, _) in syms.items())
p = subprocess.Popen(['llvm-objdump', '-d', '-C', '--no-show-raw-insn', '--start-address=%#x' % lo, '--stop-address=%#x' % hi, binary],
                     stdout=subprocess.PIPE, text=True, errors='replace')
T1 = re.compile(r'0x([0-9a-f]+) <(.*?)((?:\+0x[0-9a-f]+)?)>$')
T2 = re.compile(r'-?0x[0-9a-f]+\(%rip\)(.*?)#\s*0x([0-9a-f]+) <(.*?)((?:\+0x[0-9a-f]+)?)>')
T3 = re.compile(r'-?0x[0-9a-f]+\(%rip\)(.*?)#\s*0x[0-9a-f]+\s*$')
T4 = re.compile(r'((?<![\w-])\$?)0x([0-9a-f]{6,})\b')
res = {}; cur = None; body = []
def flush():
    if cur is None: return
    text = '\n'.join(body)
    for n in syms[cur][1]:
        res[n] = {'size': syms[cur][0], 'insns': len(body), 'sha': hashlib.sha256(text.encode()).hexdigest()[:16], 'text': text}
for line in p.stdout:
    m = re.match(r'^\s*([0-9a-f]+):\s+(.*)$', line)
    if not m: continue
    a = int(m.group(1), 16)
    if cur is None or not (cur <= a < cur + syms[cur][0]):
        flush(); cur = None
        if a not in syms: continue
        cur = a; body = []
    ins = m.group(2).rstrip(); mn = ins.split(None, 1)[0]; base = cur; size = syms[cur][0]
    def target(t):
        x = int(t.group(1), 16)
        return '<.+%#x>' % (x - base) if base <= x < base + size else '<%s%s>' % (canon(cut(t.group(2))), t.group(3) or '')
    def addr(t):
        if t.group(1) == '$' and not mn.startswith(('mov', 'lea', 'push')): return t.group(0)
        x = int(t.group(2), 16)
        return t.group(1) + '<abs>' if any(s <= x < e for s, e in seg) else t.group(0)
    ins = T1.sub(target, ins)
    ins = T2.sub(lambda t: '<%s%s>(%%rip)%s' % (canon(cut(t.group(3))), t.group(4) or '', t.group(1).rstrip()), ins)
    ins = T3.sub(lambda t: '<abs>(%rip)' + t.group(1).rstrip(), ins)
    ins = T4.sub(addr, ins)
    ins = re.sub(r'\s*#\s*imm = .*$', '', ins)
    body.append(re.sub(r'\s+', ' ', ins))
flush()
json.dump(res, open(out, 'w'))
print('%d functions, %d names, %d bytes' % (len(syms), len(res), sum(s for s, _ in syms.values())))
