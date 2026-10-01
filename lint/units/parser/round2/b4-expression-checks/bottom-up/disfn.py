#!/usr/bin/env python3
# usage: disfn.py <object> <demangled name>  -> the instructions of that function: no addresses, local jump targets as labels L<n> numbered in address order
import subprocess, sys, re
obj, name = sys.argv[1], sys.argv[2]
nm = "/usr/lib/llvm-23/bin/llvm-nm"
mangled = subprocess.run([nm, "--defined-only", "--no-sort", obj], capture_output=True, text=True).stdout.splitlines()
demangled = subprocess.run([nm, "--defined-only", "--no-sort", "--demangle", obj], capture_output=True, text=True).stdout.splitlines()
target = None
for m, d in zip(mangled, demangled):
    if d.split(" ", 2)[2] == name:
        target = m.split(" ", 2)[2]
        break
if target is None:
    sys.exit("no symbol " + name)
out = subprocess.run(["/usr/lib/llvm-23/bin/llvm-objdump", "-d", "-r", "--no-show-raw-insn", f"--disassemble-symbols={target}", obj], capture_output=True, text=True).stdout
insns = []  # [offset, text, reloc symbol or None]
for line in out.splitlines():
    m = re.match(r"^\s*([0-9a-f]+):\s+(\S.*)$", line)
    if m and not re.match(r"^\s*[0-9a-f]{16}:\s+R_", line):
        insns.append([int(m.group(1), 16), re.sub(r"\s+#.*$", "", m.group(2).strip()), None])
        continue
    r = re.match(r"^\s+[0-9a-f]{16}:\s+(R_\S+)\s+(\S+)$", line)
    if r and insns:
        insns[-1][2] = re.sub(r"[-+]0x[0-9a-f]+$", "", r.group(2))
jump = re.compile(r"^(j\w+)\s+0x([0-9a-f]+)\s+<")
targets = sorted({int(jump.match(t).group(2), 16) for _, t, rel in insns if rel is None and jump.match(t)})
labels = {t: f"L{i}" for i, t in enumerate(targets)}
lines = []
for off, text, rel in insns:
    if off in labels:
        lines.append(labels[off] + ":")
    j = jump.match(text)
    if rel is None and j:
        text = f"{j.group(1)}\t{labels[int(j.group(2), 16)]}"
    elif rel is not None:
        text = re.sub(r"\s+0x[0-9a-f]+\s+<.*$", "", text) + "\t-> " + rel
    lines.append("\t" + text)
text = "\n".join(lines) + "\n"
sys.stdout.write(subprocess.run(["/usr/lib/llvm-23/bin/llvm-cxxfilt"], input=text, capture_output=True, text=True).stdout)
