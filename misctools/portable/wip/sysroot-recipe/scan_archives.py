#!/usr/bin/env python3
"""scan_archives.py <out.json> <archive-or-object>... : per archive, count instructions with %fs:/%gs: and plain -N(%rsp) memory operands."""
import sys, re, json, subprocess, collections
LLVM = "/usr/lib/llvm-current/bin/"
seg_re = re.compile(r"%[fg]s:")
rz_re = re.compile(r"-0x[0-9a-f]+\(%rsp\)|-[0-9]+\(%rsp\)")
insn_re = re.compile(r"^\s*([0-9a-f]+):\s+(.*)$")
out = {}
for path in sys.argv[2:]:
    p = subprocess.Popen([LLVM + "llvm-objdump", "-d", "--no-show-raw-insn", path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    member = ""; func = ""
    tls = collections.Counter(); rz = collections.Counter(); forms = collections.Counter(); rzf = collections.Counter(); n = 0
    for raw in p.stdout:
        line = raw.decode("utf-8", "replace").rstrip("\n")
        if line.endswith(":\tfile format elf64-x86-64"):
            member = line.split(":")[0].split("(")[-1].rstrip(")")
            continue
        m2 = re.match(r"^[0-9a-f]+ <(.*)>:$", line)
        if m2:
            func = m2.group(1); continue
        m = insn_re.match(line)
        if not m: continue
        n += 1
        t = re.sub(r"\s+", " ", m.group(2).strip())
        if seg_re.search(t):
            tls[member] += 1; forms[re.sub(r"%r[a-z0-9]+$|%e[a-z]+$", "%reg", t)] += 1
        if rz_re.search(t) and not t.startswith("lea"):
            rz[member + ":" + func] += 1; rzf[t] += 1
    p.wait()
    out[path] = {"instructions": n, "tls_total": sum(tls.values()), "tls_members": len(tls), "tls_forms": dict(forms.most_common(6)),
                 "redzone_total": sum(rz.values()), "redzone_sites": dict(rz.most_common(20)), "redzone_forms": dict(rzf.most_common(6))}
    print(path, "instructions", n, "| %fs/%gs:", sum(tls.values()), "in", len(tls), "members", dict(forms.most_common(4)), "| below-rsp:", sum(rz.values()), dict(rz.most_common(6)))
json.dump(out, open(sys.argv[1], "w"), indent=1)
