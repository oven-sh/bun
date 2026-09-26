#!/usr/bin/env python3
"""emutls_sites.py <binary> <map> <out.json>: call sites of __emutls_get_address by object, and the emulated TLS variables."""
import sys, re, json, subprocess, collections, bisect
sys.path.insert(0, "/tmp/portable/jsc/scripts")
from analyze_binary import parse_map, short_object, LLVM
binary, mapfile, out = sys.argv[1:4]
sections, symbols = parse_map(mapfile)
starts = [s[0] for s in sections]
sym_addrs = [s[0] for s in symbols]
def locate(addr):
    i = bisect.bisect_right(starts, addr) - 1
    obj = "?"
    for j in range(i, max(-1, i - 50), -1):
        s = sections[j]
        if s[0] <= addr < s[1]:
            obj = s[2]; break
    k = bisect.bisect_right(sym_addrs, addr) - 1
    return obj, (symbols[k][1] if k >= 0 else "?")
p = subprocess.Popen([LLVM + "llvm-objdump", "-d", "--no-show-raw-insn", binary], stdout=subprocess.PIPE)
by_obj = collections.Counter(); by_fn = collections.Counter(); n = 0
for raw in p.stdout:
    if b"__emutls_get_address" not in raw: continue
    line = raw.decode("utf-8", "replace")
    m = re.match(r"^\s*([0-9a-f]+):\s+(call|jmp)\w*\s+.*<__emutls_get_address>", line)
    if not m: continue
    n += 1
    obj, sym = locate(int(m.group(1), 16))
    a, mem = short_object(obj)
    by_obj[(a + ":" + mem) if a else mem] += 1
    by_fn[sym] += 1
p.wait()
nm = subprocess.run([LLVM + "llvm-nm", "-C", "--defined-only", binary], stdout=subprocess.PIPE).stdout.decode("utf-8", "replace")
tlsvars = sorted(set(l.split(" ", 2)[2] for l in nm.splitlines() if "__emutls_v." in l))
res = {"call_sites_total": n, "by_object": by_obj.most_common(), "top_functions": by_fn.most_common(40), "emutls_variables": tlsvars}
json.dump(res, open(out, "w"), indent=1)
print("call sites of __emutls_get_address:", n)
arch = collections.Counter()
for k, v in by_obj.items(): arch[k.split(":")[0]] += v
print("by archive:", dict(arch.most_common()))
print("emulated TLS variables (%d):" % len(tlsvars))
for v in tlsvars: print("   ", v)
print("top functions:")
for f, c in by_fn.most_common(25): print("   ", c, f[:140])
