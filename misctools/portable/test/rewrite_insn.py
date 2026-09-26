#!/usr/bin/env python3
"""Test tool, aarch64: copy an ELF file and replace chosen instructions in its code.

A hosted run on a Linux test host cannot show by itself that the image stays
away from Linux: a stray "svc 0" just works there. So the tests run copies of
the image in which the instructions that must not run are traps (udf, SIGILL).

    rewrite_insn.py <in> <out> <rule>...

    no-svc          svc 0               -> udf #1   must not run on a host that is not Linux
    no-tpidr        mrs/msr tpidr_el0   -> udf #2   same
    no-tpidrro      mrs xN, tpidrro_el0 -> udf #3   must run on a macOS host only
    no-x18          mov xN, x18         -> udf #4   must run on a Windows host only
    no-x18-reload   ldr x18, [sp, #16]  -> nop      breaks the shims of the arm64 linux test
                                                    host (host/host_posix.c), a run must fail

Only executable segments are touched. Prints how many instructions each rule replaced.
"""
import struct
import sys

RULES = {
    # name: (mask, value, replacement)
    "no-svc": (0xFFFFFFFF, 0xD4000001, 0x00000001),
    "no-tpidr": (0xFFDFFFE0, 0xD51BD040, 0x00000002),  # bit 21 tells mrs from msr
    "no-tpidrro": (0xFFFFFFE0, 0xD53BD060, 0x00000003),
    "no-x18": (0xFFFFFFE0, 0xAA1203E0, 0x00000004),
    "no-x18-reload": (0xFFFFFFFF, 0xF9400BF2, 0xD503201F),
}

src, dst, names = sys.argv[1], sys.argv[2], sys.argv[3:]
data = bytearray(open(src, "rb").read())
assert data[:4] == b"\x7fELF" and data[4] == 2 and struct.unpack_from("<H", data, 18)[0] == 183, "not an aarch64 ELF file"
phoff, = struct.unpack_from("<Q", data, 32)
phentsize, phnum = struct.unpack_from("<HH", data, 54)
counts = dict.fromkeys(names, 0)
for i in range(phnum):
    p_type, p_flags, p_offset, _, _, p_filesz = struct.unpack_from("<IIQQQQ", data, phoff + i * phentsize)
    if p_type != 1 or not p_flags & 1:
        continue
    for at in range(p_offset, p_offset + p_filesz - 3, 4):
        word, = struct.unpack_from("<I", data, at)
        for name in names:
            mask, value, replacement = RULES[name]
            if word & mask == value:
                struct.pack_into("<I", data, at, replacement)
                counts[name] += 1
                break
open(dst, "wb").write(data)
print(f"{dst}:", ", ".join(f"{name} {count}" for name, count in counts.items()))
