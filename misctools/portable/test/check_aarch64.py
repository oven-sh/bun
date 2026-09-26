#!/usr/bin/env python3
"""Static checks of the aarch64 sysroot and images, on their disassembly.

    check_aarch64.py <out dir> [llvm bin dir]

1. x18 is never written: the only instruction that names x18 or w18 is
   "mov xN, x18" (the Windows way of __get_tp). Checked in libc.a, in the
   compiler-rt builtins, in the crt objects and in every image.
2. Every function of libc.a that contains "svc" also refers to __bun_host,
   except the Linux halves of the dispatchers, which are assembly.
3. tpidr_el0 is written in __set_thread_area only, and a function that reads
   it reads tpidrro_el0 and x18 as often (the three ways of __get_tp), except
   __tlsdesc_dynamic (dynamic linker, not in a static image).
4. The Linux halves are referenced by their dispatchers only.
5. Every image, whatever was linked into it: no TLS segment (the compiler
   would read tpidr_el0 for it), and rules 2 and 3 for every function, where
   "refers to __bun_host" is an adrp to its page and a load at its offset.
"""
import collections
import glob
import os
import re
import subprocess
import sys

out = sys.argv[1]
llvm = sys.argv[2] if len(sys.argv) > 2 else "/usr/lib/llvm-current/bin"
LINUX_HALVES = {
    "__clone_linux": {"__clone"},
    "__unmapself_linux": {"__unmapself"},
    "__vfork_linux": {"vfork"},
    "__syscall_cp_asm": {"__syscall_cp_c"},
    "__restore_rt": {"__libc_sigaction"},
    "__restore": {"__libc_sigaction"},
}
errors = []


def functions(path, relocs):
    text = subprocess.run([f"{llvm}/llvm-objdump", "-dr" if relocs else "-d", "--no-show-raw-insn", path],
                          capture_output=True, text=True, errors="replace").stdout
    result = collections.defaultdict(list)
    member = name = None
    for line in text.splitlines():
        m = re.match(r"^(\S.*):\s+file format", line)
        if m:
            member = m.group(1).split("(")[-1].rstrip(")")
            continue
        m = re.match(r"^[0-9a-f]+ <(.+)>:$", line)
        if m:
            name = m.group(1)
            continue
        if name and (re.match(r"^\s*[0-9a-f]+:\s", line) or "R_AARCH64_" in line):
            result[(member, name)].append(re.sub(r"^\s*[0-9a-f]+:\s+", "", line.strip()))
    return result


def check_x18(path):
    reads = others = 0
    for (member, name), lines in functions(path, False).items():
        for ins in lines:
            if re.search(r"\b[xw]18\b", ins):
                if re.fullmatch(r"mov\tx\d+, x18", ins):
                    reads += 1
                else:
                    others += 1
                    errors.append(f"{path}: {member} {name}: x18 in '{ins}'")
    return reads, others


sysroot = os.path.join(out, "sysroot/lib")
for path in [f"{sysroot}/libc.a", *sorted(glob.glob(f"{sysroot}/*crt*.o")), *sorted(glob.glob(f"{out}/builtins/lib/linux/*.a")), *sorted(glob.glob(f"{out}/*.img"))]:
    reads, others = check_x18(path)
    print(f"x18: {reads:4d} reads, {others} other uses, in {os.path.relpath(path, out)}")

libc = functions(f"{sysroot}/libc.a", True)
with_svc = guarded = readers = 0
callers = collections.defaultdict(set)
for (member, name), lines in libc.items():
    text = "\n".join(lines)
    svc = len(re.findall(r"^svc\t", text, re.M))
    host = "__bun_host" in text
    tp = len(re.findall(r"^mrs\tx\d+, TPIDR_EL0", text, re.M))
    ro = len(re.findall(r"^mrs\tx\d+, TPIDRRO_EL0", text, re.M))
    x18 = len(re.findall(r"^mov\tx\d+, x18", text, re.M))
    if re.search(r"^msr\tTPIDR", text, re.M) and name != "__set_thread_area":
        errors.append(f"libc.a: {member} {name} writes a thread register")
    if svc:
        with_svc += 1
        if name in LINUX_HALVES:
            pass
        elif host:
            guarded += 1
        else:
            errors.append(f"libc.a: {member} {name} has svc and no reference to __bun_host")
    if tp or ro or x18:
        readers += 1
        if not (tp == ro == x18 and host) and name != "__tlsdesc_dynamic":
            errors.append(f"libc.a: {member} {name} reads tpidr_el0 {tp}, tpidrro_el0 {ro}, x18 {x18} times")
    for half in LINUX_HALVES:
        if re.search(rf"R_AARCH64_\w+\s+{half}\b", text):
            callers[half].add(name)
print(f"svc: {with_svc} functions of libc.a, {guarded} refer to __bun_host, {with_svc - guarded} do not (Linux halves, or errors below)")
print(f"thread register: {readers} functions of libc.a read it (the three ways, or errors below)")
for half, allowed in LINUX_HALVES.items():
    if callers[half] != allowed:
        errors.append(f"libc.a: {half} is referenced by {sorted(callers[half])}, expected {sorted(allowed)}")
if not any("is referenced by" in e for e in errors):
    print("Linux halves: referenced by their dispatchers only")

for path in sorted(glob.glob(f"{out}/*.img")):
    image = os.path.relpath(path, out)
    before = len(errors)
    headers = subprocess.run([f"{llvm}/llvm-readelf", "-lW", path], capture_output=True, text=True).stdout
    if re.search(r"^\s*TLS\s", headers, re.M):
        errors.append(f"{image}: has a TLS segment")
    symbols = subprocess.run([f"{llvm}/llvm-nm", path], capture_output=True, text=True).stdout
    host_at = int(re.search(r"^([0-9a-f]+) \w __bun_host$", symbols, re.M).group(1), 16)
    page, low = host_at & ~0xfff, host_at & 0xfff
    with_svc = readers = 0
    for (_, name), lines in functions(path, False).items():
        text = "\n".join(lines)
        host = re.search(rf"^adrp\tx\d+, {page:#x}\b", text, re.M) and re.search(rf"^ldr\tx\d+, \[x\d+, #{low:#x}\]", text, re.M)
        tp = len(re.findall(r"^mrs\tx\d+, TPIDR_EL0", text, re.M))
        ro = len(re.findall(r"^mrs\tx\d+, TPIDRRO_EL0", text, re.M))
        x18 = len(re.findall(r"^mov\tx\d+, x18", text, re.M))
        if re.search(r"^msr\tTPIDR", text, re.M) and name != "__set_thread_area":
            errors.append(f"{image}: {name} writes a thread register")
        if re.search(r"^svc\t", text, re.M):
            with_svc += 1
            if name not in LINUX_HALVES and not host:
                errors.append(f"{image}: {name} has svc and does not read __bun_host.os")
        if tp or ro or x18:
            readers += 1
            if not (tp == ro == x18 and host):
                errors.append(f"{image}: {name} reads tpidr_el0 {tp}, tpidrro_el0 {ro}, x18 {x18} times")
    if len(errors) == before:
        print(f"{image}: no TLS segment, {with_svc} functions with svc and {readers} that read the thread register, all by the rules")

for e in errors:
    print("ERROR", e)
sys.exit(1 if errors else 0)
